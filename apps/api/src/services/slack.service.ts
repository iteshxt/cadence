import { randomBytes } from 'node:crypto';
import type { SlackStatus } from '@cadence/shared';
import { eq } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import type { Env } from '../config/env.js';
import type { Db } from '../db/client.js';
import { slackConnections } from '../db/schema.js';
import type { Crypto } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

const SCOPES = 'incoming-webhook,chat:write';
/** Webhook responses that mean the install is gone and the connection should be dropped. */
const DEAD_HOOK_BODIES = new Set([
  'no_service',
  'invalid_token',
  'channel_not_found',
  'no_active_hooks',
  'team_disabled',
]);

export interface SlackMessage {
  text: string;
  blocks?: unknown[];
}

export type FetchFn = typeof fetch;

export interface SlackDeps {
  db: Db;
  crypto: Crypto;
  env: Pick<Env, 'SLACK_CLIENT_ID' | 'SLACK_CLIENT_SECRET' | 'SLACK_REDIRECT_URI' | 'STATE_SECRET'>;
  log: Logger;
  fetch?: FetchFn;
}

export type PostResult = 'sent' | 'not-connected' | 'disconnected';

export function createSlack(deps: SlackDeps) {
  const http = deps.fetch ?? fetch;
  const stateKey = new TextEncoder().encode(deps.env.STATE_SECRET);

  function requireConfigured() {
    const { SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_REDIRECT_URI } = deps.env;
    if (!SLACK_CLIENT_ID || !SLACK_CLIENT_SECRET || !SLACK_REDIRECT_URI) {
      throw new AppError(503, 'SLACK_ERROR', 'Slack isn’t configured on this server.');
    }
    return {
      clientId: SLACK_CLIENT_ID,
      clientSecret: SLACK_CLIENT_SECRET,
      redirectUri: SLACK_REDIRECT_URI,
    };
  }

  async function connection(userId: string) {
    const [row] = await deps.db
      .select()
      .from(slackConnections)
      .where(eq(slackConnections.userId, userId));
    return row ?? null;
  }

  async function remove(userId: string) {
    await deps.db.delete(slackConnections).where(eq(slackConnections.userId, userId));
  }

  return {
    async status(userId: string): Promise<SlackStatus> {
      const row = await connection(userId);
      return row
        ? { connected: true, teamName: row.teamName, channelName: row.channelName }
        : { connected: false };
    },

    /** Slack authorize URL with a signed, 10-minute `state` that carries the user ID (CSRF protection). */
    async authorizeUrl(userId: string): Promise<string> {
      const { clientId, redirectUri } = requireConfigured();
      const state = await new SignJWT({ nonce: randomBytes(12).toString('base64url') })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime('10m')
        .setAudience('slack-oauth')
        .sign(stateKey);
      const url = new URL('https://slack.com/oauth/v2/authorize');
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('scope', SCOPES);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('state', state);
      return url.toString();
    },

    /** Exchanges the OAuth code and stores the encrypted connection. Returns the user it belongs to. */
    async completeOAuth(code: string, state: string): Promise<string> {
      const { clientId, clientSecret, redirectUri } = requireConfigured();
      let userId: string;
      try {
        const { payload } = await jwtVerify(state, stateKey, { audience: 'slack-oauth' });
        if (!payload.sub) throw new Error('missing subject');
        userId = payload.sub;
      } catch {
        throw new AppError(
          400,
          'SLACK_ERROR',
          'The Slack sign-in link expired. Try connecting again.',
        );
      }

      const res = await http('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        error?: string;
        access_token?: string;
        team?: { id: string; name: string };
        incoming_webhook?: { channel: string; url: string };
      };
      if (!body.ok || !body.access_token || !body.incoming_webhook || !body.team) {
        deps.log.warn({ error: body.error }, 'slack oauth exchange failed');
        throw new AppError(
          502,
          'SLACK_ERROR',
          `Slack didn’t complete the connection${body.error ? ` (${body.error})` : ''}.`,
        );
      }

      const values = {
        userId,
        teamId: body.team.id,
        teamName: body.team.name,
        channelName: body.incoming_webhook.channel.replace(/^#/, ''),
        webhookUrlEnc: deps.crypto.encrypt(body.incoming_webhook.url),
        accessTokenEnc: deps.crypto.encrypt(body.access_token),
        connectedAt: new Date(),
      };
      await deps.db
        .insert(slackConnections)
        .values(values)
        .onConflictDoUpdate({
          target: slackConnections.userId,
          set: { ...values, userId: undefined },
        });
      deps.log.info({ userId, team: body.team.name }, 'slack connected');
      return userId;
    },

    async disconnect(userId: string): Promise<void> {
      const row = await connection(userId);
      if (!row) return;
      try {
        await http('https://slack.com/api/auth.revoke', {
          method: 'POST',
          headers: { authorization: `Bearer ${deps.crypto.decrypt(row.accessTokenEnc)}` },
        });
      } catch (err) {
        deps.log.warn({ err, userId }, 'slack token revoke failed; deleting the connection anyway');
      }
      await remove(userId);
    },

    /**
     * Posts to the user's webhook, reading the connection at send time so connect and disconnect
     * take effect immediately. A dead install is removed rather than retried forever.
     */
    async post(userId: string, message: SlackMessage): Promise<PostResult> {
      const row = await connection(userId);
      if (!row) return 'not-connected';
      const res = await http(deps.crypto.decrypt(row.webhookUrlEnc), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
      });
      if (res.ok) return 'sent';
      const text = (await res.text()).trim();
      if (res.status === 404 || res.status === 410 || DEAD_HOOK_BODIES.has(text)) {
        await remove(userId);
        deps.log.warn(
          { userId, status: res.status, body: text },
          'slack webhook is gone; connection removed',
        );
        return 'disconnected';
      }
      throw new Error(`Slack webhook returned ${res.status}: ${text.slice(0, 200)}`);
    },
  };
}

export type Slack = ReturnType<typeof createSlack>;

const utcTime = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});

/** Copy from design.md §11. Slack has no user timezone, so times are UTC. */
export function limitMessage(
  senderLabel: string,
  cap: number,
  affected: number,
  nextWindowStart: Date,
): SlackMessage {
  const when = `${utcTime.format(nextWindowStart)} UTC`;
  const moved =
    affected > 0
      ? ` About ${affected.toLocaleString('en-US')} emails moved to ${when}.`
      : ` Further emails move to ${when}.`;
  const text = `⚠️ ${senderLabel} reached its hourly limit (${cap.toLocaleString('en-US')} of ${cap.toLocaleString('en-US')}).${moved}`;
  return {
    text,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'Cadence defers extra emails to the next hour. Nothing is dropped.',
          },
        ],
      },
    ],
  };
}

export const TEST_MESSAGE: SlackMessage = {
  text: 'Cadence is connected. You’ll get a message here when a sender reaches its hourly limit.',
};
