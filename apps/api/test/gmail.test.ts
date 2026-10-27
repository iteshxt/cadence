import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { senders, type SenderRow } from '../src/db/schema.js';
import type { GmailConnectError } from '../src/services/gmail.service.js';
import { createGmail, GmailError, type FetchFn } from '../src/services/gmail.service.js';
import { resetState, seedSenders, seedUser, testContext } from './helpers.js';

const ctx = testContext({
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
});

const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

interface Call {
  url: string;
  body: string;
}

/** A stubbed Google: answers by URL with queued responses, and records every call. */
function fakeGoogle() {
  const calls: Call[] = [];
  const queues = new Map<string, (Response | Error)[]>();
  const fetch: FetchFn = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? '') });
    const key = [...queues.keys()].find((k) => url.startsWith(k));
    const next = key ? queues.get(key)!.shift() : undefined;
    if (!next) throw new Error(`unexpected request to ${url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  return {
    calls,
    fetch,
    on(urlPrefix: string, ...responses: (Response | Error)[]) {
      queues.set(urlPrefix, [...(queues.get(urlPrefix) ?? []), ...responses]);
    },
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const TOKEN = 'https://oauth2.googleapis.com/token';
const SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const tokenOk = () => json(200, { access_token: 'access-1', expires_in: 3600 });
const email = { emailId: 'e-1', to: 'lead@example.com', subject: 'Hello', text: 'Hi there' };

function service(google: ReturnType<typeof fakeGoogle>, dryRun = false) {
  return createGmail({
    db: ctx.db,
    crypto: ctx.crypto,
    env: { ...ctx.env, SEND_DRY_RUN: dryRun },
    log: ctx.log,
    fetch: google.fetch,
  });
}

let sender: SenderRow;
let userId: string;

beforeEach(async () => {
  await resetState(ctx);
  userId = (await seedUser(ctx)).id;
  [sender] = (await seedSenders(ctx, userId, 1, { displayName: 'Alice Doe' })) as [SenderRow];
});
afterAll(async () => {
  await ctx.close();
});

describe('sending', () => {
  it('refreshes once, caches the token, and posts a MIME message with a fixed Message-ID', async () => {
    const google = fakeGoogle();
    google.on(TOKEN, tokenOk());
    google.on(SEND, json(200, { id: 'gm-1' }), json(200, { id: 'gm-2' }));
    const gmail = service(google);

    const first = await gmail.send(sender, email);
    await gmail.send(sender, { ...email, emailId: 'e-2' });

    expect(first).toEqual({
      messageId: 'gm-1',
      previewUrl: `https://mail.google.com/mail/?authuser=${encodeURIComponent(sender.fromEmail)}#all/gm-1`,
    });
    expect(google.calls.filter((c) => c.url === TOKEN)).toHaveLength(1);
    const raw = Buffer.from(JSON.parse(google.calls[1]!.body).raw, 'base64url').toString();
    expect(raw).toContain('Message-ID: <e-1@cadence.local>');
    expect(raw).toContain(`From: Alice Doe <${sender.fromEmail}>`);
    expect(raw).toContain('To: lead@example.com');
  });

  it.each([
    ['a 401 (and drops the cached token)', json(401, {}), 'retryable'],
    ['a 429', json(429, {}), 'retryable'],
    [
      'a rate-limit 403',
      json(403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }),
      'retryable',
    ],
    ['another 403', json(403, { error: { errors: [{ reason: 'forbidden' }] } }), 'permanent'],
    ['a 400', json(400, { error: { status: 'INVALID_ARGUMENT' } }), 'permanent'],
    ['a 500', json(500, {}), 'ambiguous'],
    [
      'a refused connection',
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
      'retryable',
    ],
    [
      'a dropped connection',
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }),
      'ambiguous',
    ],
  ])('classifies %s', async (_name, response, kind) => {
    const google = fakeGoogle();
    google.on(TOKEN, tokenOk(), tokenOk());
    google.on(SEND, response);
    const gmail = service(google);
    const err = await gmail.send(sender, email).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GmailError);
    expect((err as GmailError).kind).toBe(kind);
  });

  it('marks the sender for reconnecting when Google rejects the refresh token', async () => {
    const google = fakeGoogle();
    google.on(TOKEN, json(400, { error: 'invalid_grant' }));
    const err = await service(google)
      .send(sender, email)
      .catch((e: unknown) => e);
    expect((err as GmailError).kind).toBe('permanent');
    const [row] = await ctx.db.select().from(senders).where(eq(senders.id, sender.id));
    expect(row!.needsReconnect).toBe(true);
  });

  it('retries when the token refresh itself fails, since nothing was sent', async () => {
    const google = fakeGoogle();
    google.on(TOKEN, new TypeError('fetch failed'));
    const err = await service(google)
      .send(sender, email)
      .catch((e: unknown) => e);
    expect((err as GmailError).kind).toBe('retryable');
  });

  it('records the send without calling Google in dry-run mode', async () => {
    const google = fakeGoogle();
    expect(await service(google, true).send(sender, email)).toEqual({
      messageId: 'dry-run-e-1',
      previewUrl: null,
    });
    expect(google.calls).toHaveLength(0);
  });
});

describe('connecting with a refresh token', () => {
  const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
  const refreshed = (scope: string) =>
    json(200, { access_token: 'a', expires_in: 3600, scope: `openid email ${scope}` });
  const me = () => json(200, { email: 'me@gmail.com', email_verified: true, name: 'Me' });
  const rowsFor = () => ctx.db.select().from(senders).where(eq(senders.fromEmail, 'me@gmail.com'));

  it('adds the signed-in Gmail account as a sender', async () => {
    const google = fakeGoogle();
    google.on(TOKEN, refreshed(SEND_SCOPE));
    google.on(USERINFO, me());
    expect(await service(google).connectWithRefreshToken(userId, 'r-sign-in')).toBe('connected');
    const [row] = await rowsFor();
    expect(row).toMatchObject({ userId, displayName: 'Me', hourlyLimit: 20, isActive: true });
    expect(ctx.crypto.decrypt(row!.refreshTokenEnc!)).toBe('r-sign-in');
  });

  it('stores nothing when the user unticked the Gmail permission', async () => {
    const google = fakeGoogle();
    google.on(TOKEN, refreshed('profile'));
    expect(await service(google).connectWithRefreshToken(userId, 'r')).toBe('scope');
    expect(await rowsFor()).toEqual([]);
  });

  it('reactivates a disconnected sender only through Connect Gmail', async () => {
    const google = fakeGoogle();
    google.on(TOKEN, refreshed(SEND_SCOPE), refreshed(SEND_SCOPE));
    google.on(USERINFO, me(), me());
    await seedSenders(ctx, userId, 1, {
      fromEmail: 'me@gmail.com',
      label: 'Sales',
      hourlyLimit: 7,
      isActive: false,
      refreshTokenEnc: null,
    });
    const gmail = service(google);
    expect(await gmail.connectWithRefreshToken(userId, 'r-1')).toBe('disconnected');
    expect(await gmail.connectWithRefreshToken(userId, 'r-2', { reconnect: true })).toBe(
      'connected',
    );
    const [row] = await rowsFor();
    expect(row).toMatchObject({ isActive: true, label: 'Sales', hourlyLimit: 7 });
    expect(ctx.crypto.decrypt(row!.refreshTokenEnc!)).toBe('r-2');
  });

  it('never reconnects a sender the user disconnected', async () => {
    const google = fakeGoogle();
    google.on(TOKEN, refreshed(SEND_SCOPE));
    google.on(USERINFO, me());
    await seedSenders(ctx, userId, 1, {
      fromEmail: 'me@gmail.com',
      isActive: false,
      refreshTokenEnc: null,
    });
    expect(await service(google).connectWithRefreshToken(userId, 'r-new')).toBe('disconnected');
    const [row] = await rowsFor();
    expect(row).toMatchObject({ isActive: false, refreshTokenEnc: null });
  });

  it('refuses a token Google rejects', async () => {
    const google = fakeGoogle();
    google.on(TOKEN, json(400, { error: 'invalid_grant' }));
    const err = await service(google)
      .connectWithRefreshToken(userId, 'stolen')
      .catch((e: unknown) => e);
    expect((err as GmailConnectError).reason).toBe('exchange');
  });
});
