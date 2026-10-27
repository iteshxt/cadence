import { randomBytes } from 'node:crypto';
import { LIMITS } from '@cadence/shared';
import { eq } from 'drizzle-orm';
import { decodeJwt, jwtVerify, SignJWT } from 'jose';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import type { Env } from '../config/env.js';
import type { Db } from '../db/client.js';
import { senders, type SenderRow } from '../db/schema.js';
import type { Crypto } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const SCOPES = `openid email profile ${SEND_SCOPE}`;
const STATE_AUDIENCE = 'gmail-oauth';

/** Refresh a cached access token this long before Google says it expires. */
const TOKEN_MARGIN_MS = 60_000;
const TOKEN_TIMEOUT_MS = 15_000;
const SEND_TIMEOUT_MS = 30_000;

/** Network failures that happen before the request leaves this machine: nothing was sent. */
const PRE_REQUEST_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
]);
/** `403` reasons that mean "slow down", not "never". */
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);

export type SendErrorKind = 'retryable' | 'ambiguous' | 'permanent';

/** A send failure with its retry class already decided (tech-spec §7.3). */
export class GmailError extends Error {
  constructor(
    message: string,
    readonly kind: SendErrorKind,
  ) {
    super(message);
    this.name = 'GmailError';
  }
}

/**
 * Whether a failed send may be retried without risking a duplicate (tech-spec §7.2 step 7).
 * Only failures where Gmail certainly did not accept the message are retryable; anything this
 * module didn't classify is ambiguous and must not be retried.
 */
export function classifySendError(err: unknown): SendErrorKind {
  return err instanceof GmailError ? err.kind : 'ambiguous';
}

/** Why connecting Gmail failed, mapped to the Settings redirect (`?gmail=`). */
export class GmailConnectError extends Error {
  constructor(
    readonly reason: 'state' | 'scope' | 'unverified' | 'exchange',
    message: string,
  ) {
    super(message);
    this.name = 'GmailConnectError';
  }
}

export interface OutgoingEmail {
  emailId: string;
  to: string;
  subject: string;
  text: string;
}

export interface SendResult {
  messageId: string;
  previewUrl: string | null;
}

export type SendFn = (sender: SenderRow, email: OutgoingEmail) => Promise<SendResult>;

export type FetchFn = typeof fetch;

export interface GmailDeps {
  db: Db;
  crypto: Crypto;
  env: Pick<
    Env,
    | 'GOOGLE_CLIENT_ID'
    | 'GOOGLE_CLIENT_SECRET'
    | 'GMAIL_REDIRECT_URI'
    | 'STATE_SECRET'
    | 'MAX_EMAILS_PER_HOUR_PER_SENDER'
    | 'SEND_DRY_RUN'
  >;
  log: Logger;
  fetch?: FetchFn;
  now?: () => number;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** undici puts the socket error code on `cause`. */
function networkCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.cause?.code ?? e.code;
}

/** Gmail's error body: `{ error: { status, errors: [{ reason }] } }`. */
function errorReason(body: unknown): string | undefined {
  const e = (body as { error?: { status?: string; errors?: { reason?: string }[] } })?.error;
  return e?.errors?.[0]?.reason ?? e?.status;
}

export function gmailLink(fromEmail: string, messageId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(fromEmail)}#all/${messageId}`;
}

export function createGmail(deps: GmailDeps) {
  const http = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const stateKey = new TextEncoder().encode(deps.env.STATE_SECRET);
  /** Access tokens by sender ID. They live only in this process's memory. */
  const tokens = new Map<string, { token: string; expiresAt: number }>();

  function requireConfigured() {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REDIRECT_URI } = deps.env;
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GMAIL_REDIRECT_URI) {
      throw new AppError(503, 'GMAIL_ERROR', 'Gmail isn’t configured on this server.');
    }
    return {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      redirectUri: GMAIL_REDIRECT_URI,
    };
  }

  async function postForm(url: string, form: Record<string, string>, timeoutMs: number) {
    return http(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  async function markNeedsReconnect(senderId: string) {
    await deps.db
      .update(senders)
      .set({ needsReconnect: true, updatedAt: new Date() })
      .where(eq(senders.id, senderId));
  }

  /** A valid access token for the sender, refreshed when the cached one is about to expire. */
  async function accessToken(sender: SenderRow): Promise<string> {
    const cached = tokens.get(sender.id);
    if (cached && cached.expiresAt > now()) return cached.token;

    if (!sender.refreshTokenEnc) {
      throw new GmailError('This sender is disconnected. Reconnect it in Settings.', 'permanent');
    }
    let config: ReturnType<typeof requireConfigured>;
    try {
      config = requireConfigured();
    } catch (err) {
      throw new GmailError(messageOf(err), 'permanent');
    }

    let res: Response;
    try {
      res = await postForm(
        TOKEN_URL,
        {
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: deps.crypto.decrypt(sender.refreshTokenEnc),
          grant_type: 'refresh_token',
        },
        TOKEN_TIMEOUT_MS,
      );
    } catch (err) {
      // Nothing was sent to Gmail yet, so any failure here is safe to retry.
      throw new GmailError(
        `Couldn’t reach Google to refresh access: ${messageOf(err)}`,
        'retryable',
      );
    }

    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (res.ok && body.access_token) {
      tokens.set(sender.id, {
        token: body.access_token,
        expiresAt: now() + (body.expires_in ?? 3600) * 1000 - TOKEN_MARGIN_MS,
      });
      return body.access_token;
    }
    if (body.error === 'invalid_grant') {
      await markNeedsReconnect(sender.id);
      deps.log.warn(
        { senderId: sender.id },
        'google rejected the refresh token; sender needs reconnecting',
      );
      throw new GmailError(
        'Google no longer accepts this sender’s access. Reconnect it in Settings.',
        'permanent',
      );
    }
    throw new GmailError(
      `Google couldn’t refresh access (${res.status}${body.error ? ` ${body.error}` : ''})`,
      res.status >= 500 ? 'retryable' : 'permanent',
    );
  }

  /** The RFC 822 message, base64url-encoded for the Gmail API. Message-ID is deterministic. */
  async function rawMessage(sender: SenderRow, email: OutgoingEmail): Promise<string> {
    const message = new MailComposer({
      from: sender.displayName
        ? { name: sender.displayName, address: sender.fromEmail }
        : sender.fromEmail,
      to: email.to,
      subject: email.subject,
      text: email.text,
      messageId: `<${email.emailId}@cadence.local>`,
    });
    const built = await message.compile().build();
    return built.toString('base64url');
  }

  /**
   * Upserts the sender on (user, address). A reconnect refreshes its access and keeps its label,
   * display name, and limit. With `reactivate: false` (sign-in), a sender the user disconnected
   * is left alone and nothing is returned.
   */
  async function saveSender(input: {
    userId: string;
    email: string;
    name?: string;
    refreshToken: string;
    accessToken?: string;
    expiresIn?: number;
    reactivate: boolean;
  }): Promise<string | null> {
    const refreshTokenEnc = deps.crypto.encrypt(input.refreshToken);
    const [row] = await deps.db
      .insert(senders)
      .values({
        userId: input.userId,
        label: input.email,
        fromEmail: input.email,
        displayName: input.name ?? null,
        hourlyLimit: Math.min(
          LIMITS.SENDER_HOURLY_DEFAULT,
          deps.env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        ),
        refreshTokenEnc,
      })
      .onConflictDoUpdate({
        target: [senders.userId, senders.fromEmail],
        set: { refreshTokenEnc, isActive: true, needsReconnect: false, updatedAt: new Date() },
        setWhere: input.reactivate ? undefined : eq(senders.isActive, true),
      })
      .returning({ id: senders.id });
    if (!row) return null;
    if (input.accessToken) {
      tokens.set(row.id, {
        token: input.accessToken,
        expiresAt: now() + (input.expiresIn ?? 3600) * 1000 - TOKEN_MARGIN_MS,
      });
    }
    deps.log.info({ userId: input.userId, senderId: row.id }, 'gmail connected');
    return row.id;
  }

  const send: SendFn = async (sender, email) => {
    if (deps.env.SEND_DRY_RUN) return { messageId: `dry-run-${email.emailId}`, previewUrl: null };

    const raw = await rawMessage(sender, email);
    const token = await accessToken(sender);

    let res: Response;
    try {
      res = await http(SEND_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch (err) {
      const code = networkCode(err);
      if (code && PRE_REQUEST_CODES.has(code)) {
        throw new GmailError(`Couldn’t reach Gmail (${code})`, 'retryable');
      }
      // A timeout or a dropped connection: Gmail may have accepted the message.
      throw new GmailError(`Gmail didn’t answer: ${messageOf(err)}`, 'ambiguous');
    }

    if (res.ok) {
      // Accepted. A malformed body must not turn a sent email into a failure.
      const body = (await res.json().catch(() => null)) as { id?: string } | null;
      return body?.id
        ? { messageId: body.id, previewUrl: gmailLink(sender.fromEmail, body.id) }
        : { messageId: `<${email.emailId}@cadence.local>`, previewUrl: null };
    }

    const reason = errorReason(await res.json().catch(() => null));
    const detail = `Gmail returned ${res.status}${reason ? ` ${reason}` : ''}`;
    if (res.status === 401) {
      tokens.delete(sender.id);
      throw new GmailError(detail, 'retryable');
    }
    if (res.status === 429 || (res.status === 403 && reason && RATE_LIMIT_REASONS.has(reason))) {
      throw new GmailError(detail, 'retryable');
    }
    if (res.status >= 500) throw new GmailError(detail, 'ambiguous');
    throw new GmailError(detail, 'permanent');
  };

  return {
    send,

    /** Google's consent URL with a signed, 10-minute `state` that carries the user ID. */
    async authorizeUrl(userId: string): Promise<string> {
      const { clientId, redirectUri } = requireConfigured();
      const state = await new SignJWT({ nonce: randomBytes(12).toString('base64url') })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime('10m')
        .setAudience(STATE_AUDIENCE)
        .sign(stateKey);
      const url = new URL(AUTH_URL);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', SCOPES);
      url.searchParams.set('access_type', 'offline');
      url.searchParams.set('prompt', 'consent');
      url.searchParams.set('include_granted_scopes', 'true');
      url.searchParams.set('state', state);
      return url.toString();
    },

    /**
     * Exchanges the code and stores the sender (tech-spec §7.3). Reconnecting an address the user
     * already has refreshes its access and keeps its label, display name, and limit.
     */
    async completeOAuth(
      code: string,
      state: string,
    ): Promise<{ userId: string; fromEmail: string }> {
      const { clientId, clientSecret, redirectUri } = requireConfigured();
      let userId: string;
      try {
        const { payload } = await jwtVerify(state, stateKey, { audience: STATE_AUDIENCE });
        if (!payload.sub) throw new Error('missing subject');
        userId = payload.sub;
      } catch {
        throw new GmailConnectError('state', 'The Google sign-in link expired.');
      }

      const res = await postForm(
        TOKEN_URL,
        {
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        },
        TOKEN_TIMEOUT_MS,
      );
      const body = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        expires_in?: number;
        refresh_token?: string;
        scope?: string;
        id_token?: string;
        error?: string;
      };
      if (!res.ok || !body.refresh_token || !body.id_token) {
        deps.log.warn({ status: res.status, error: body.error }, 'google token exchange failed');
        throw new GmailConnectError('exchange', 'Google didn’t complete the connection.');
      }
      if (!body.scope?.split(' ').includes(SEND_SCOPE)) {
        // The consent screen lets people untick the Gmail box. Without it we can't send.
        throw new GmailConnectError('scope', 'Cadence needs permission to send email.');
      }

      // The ID token came straight from Google's token endpoint over TLS, so its claims can be
      // read without verifying the signature (Google's documented exception).
      const claims = decodeJwt(body.id_token) as {
        email?: string;
        email_verified?: boolean;
        name?: string;
      };
      if (!claims.email || claims.email_verified !== true) {
        throw new GmailConnectError('unverified', 'This Google account’s address isn’t verified.');
      }

      await saveSender({
        userId,
        email: claims.email,
        name: claims.name,
        refreshToken: body.refresh_token,
        accessToken: body.access_token,
        expiresIn: body.expires_in,
        reactivate: true,
      });
      return { userId, fromEmail: claims.email };
    },

    /**
     * Turns the refresh token from Google sign-in into a sender (PRD SET-1a, tech-spec §7.3).
     * Supabase uses the same OAuth client, so the token refreshes with our credentials.
     */
    async connectFromSignIn(
      userId: string,
      refreshToken: string,
    ): Promise<'connected' | 'scope' | 'disconnected'> {
      const { clientId, clientSecret } = requireConfigured();
      const res = await postForm(
        TOKEN_URL,
        {
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        },
        TOKEN_TIMEOUT_MS,
      );
      const body = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        expires_in?: number;
        scope?: string;
        error?: string;
      };
      if (!res.ok || !body.access_token) {
        deps.log.warn({ status: res.status, error: body.error }, 'sign-in refresh token rejected');
        throw new GmailConnectError('exchange', 'Google didn’t accept the sign-in token.');
      }
      if (!body.scope?.split(' ').includes(SEND_SCOPE)) return 'scope';

      const info = await http(USERINFO_URL, {
        headers: { authorization: `Bearer ${body.access_token}` },
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });
      const claims = (await info.json().catch(() => ({}))) as {
        email?: string;
        email_verified?: boolean;
        name?: string;
      };
      if (!info.ok || !claims.email || claims.email_verified !== true) {
        throw new GmailConnectError('unverified', 'This Google account’s address isn’t verified.');
      }

      const saved = await saveSender({
        userId,
        email: claims.email,
        name: claims.name,
        refreshToken,
        accessToken: body.access_token,
        expiresIn: body.expires_in,
        reactivate: false,
      });
      return saved ? 'connected' : 'disconnected';
    },

    /** Revokes a refresh token at Google. Best effort: the caller clears it either way. */
    async revoke(refreshTokenEnc: string): Promise<void> {
      try {
        await postForm(
          REVOKE_URL,
          { token: deps.crypto.decrypt(refreshTokenEnc) },
          TOKEN_TIMEOUT_MS,
        );
      } catch (err) {
        deps.log.warn({ err: messageOf(err) }, 'google token revoke failed; clearing it anyway');
      }
    },

    /** Drops a cached access token (after disconnect). */
    forget(senderId: string): void {
      tokens.delete(senderId);
    },
  };
}

export type Gmail = ReturnType<typeof createGmail>;
