import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { senders, type SenderRow } from '../src/db/schema.js';
import type { GmailConnectError } from '../src/services/gmail.service.js';
import { createGmail, GmailError, type FetchFn } from '../src/services/gmail.service.js';
import { resetState, seedSenders, seedUser, testContext } from './helpers.js';

const ctx = testContext({
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  GMAIL_REDIRECT_URI: 'http://localhost:4000/api/integrations/gmail/callback',
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

/** An unsigned ID token: the service reads its claims without verifying (tech-spec §7.3). */
async function idToken(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode('not-google'));
}

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

describe('connecting', () => {
  async function stateFor(gmail: ReturnType<typeof service>, uid: string) {
    return new URL(await gmail.authorizeUrl(uid)).searchParams.get('state')!;
  }

  it('asks for offline gmail.send access with a signed state', async () => {
    const url = new URL(await service(fakeGoogle()).authorizeUrl(userId));
    expect(url.searchParams.get('scope')).toContain(SEND_SCOPE);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('stores a new sender with the default limit, and a reconnect keeps its settings', async () => {
    const google = fakeGoogle();
    const gmail = service(google);
    const token = await idToken({
      email: 'new@gmail.com',
      email_verified: true,
      name: 'New Person',
    });
    const exchange = () =>
      json(200, {
        access_token: 'a',
        expires_in: 3600,
        refresh_token: 'r-1',
        scope: `openid email ${SEND_SCOPE}`,
        id_token: token,
      });
    google.on(TOKEN, exchange(), exchange());

    await gmail.completeOAuth('code', await stateFor(gmail, userId));
    const [created] = await ctx.db
      .select()
      .from(senders)
      .where(eq(senders.fromEmail, 'new@gmail.com'));
    expect(created).toMatchObject({
      userId,
      label: 'new@gmail.com',
      displayName: 'New Person',
      hourlyLimit: 20,
      isActive: true,
    });
    expect(ctx.crypto.decrypt(created!.refreshTokenEnc!)).toBe('r-1');

    await ctx.db
      .update(senders)
      .set({ label: 'Sales', hourlyLimit: 7, isActive: false, needsReconnect: true })
      .where(eq(senders.id, created!.id));
    await gmail.completeOAuth('code', await stateFor(gmail, userId));
    const rows = await ctx.db.select().from(senders).where(eq(senders.fromEmail, 'new@gmail.com'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      label: 'Sales',
      hourlyLimit: 7,
      isActive: true,
      needsReconnect: false,
    });
  });

  it('refuses when the user unticked the Gmail permission', async () => {
    const google = fakeGoogle();
    const gmail = service(google);
    google.on(
      TOKEN,
      json(200, {
        refresh_token: 'r',
        scope: 'openid email',
        id_token: await idToken({ email: 'x@gmail.com', email_verified: true }),
      }),
    );
    const err = await gmail
      .completeOAuth('code', await stateFor(gmail, userId))
      .catch((e: unknown) => e);
    expect((err as GmailConnectError).reason).toBe('scope');
    expect(await ctx.db.select().from(senders).where(eq(senders.fromEmail, 'x@gmail.com'))).toEqual(
      [],
    );
  });

  it('refuses an unverified address and a forged state', async () => {
    const google = fakeGoogle();
    const gmail = service(google);
    google.on(
      TOKEN,
      json(200, {
        refresh_token: 'r',
        scope: SEND_SCOPE,
        id_token: await idToken({ email: 'y@gmail.com', email_verified: false }),
      }),
    );
    const unverified = await gmail
      .completeOAuth('code', await stateFor(gmail, userId))
      .catch((e: unknown) => e);
    expect((unverified as GmailConnectError).reason).toBe('unverified');

    const forged = await gmail.completeOAuth('code', 'not-a-state').catch((e: unknown) => e);
    expect((forged as GmailConnectError).reason).toBe('state');
  });
});

describe('connecting at sign-in', () => {
  const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
  const refreshed = (scope: string) =>
    json(200, { access_token: 'a', expires_in: 3600, scope: `openid email ${scope}` });
  const me = () => json(200, { email: 'me@gmail.com', email_verified: true, name: 'Me' });
  const rowsFor = () => ctx.db.select().from(senders).where(eq(senders.fromEmail, 'me@gmail.com'));

  it('adds the signed-in Gmail account as a sender', async () => {
    const google = fakeGoogle();
    google.on(TOKEN, refreshed(SEND_SCOPE));
    google.on(USERINFO, me());
    expect(await service(google).connectFromSignIn(userId, 'r-sign-in')).toBe('connected');
    const [row] = await rowsFor();
    expect(row).toMatchObject({ userId, displayName: 'Me', hourlyLimit: 20, isActive: true });
    expect(ctx.crypto.decrypt(row!.refreshTokenEnc!)).toBe('r-sign-in');
  });

  it('stores nothing when the user unticked the Gmail permission', async () => {
    const google = fakeGoogle();
    google.on(TOKEN, refreshed('profile'));
    expect(await service(google).connectFromSignIn(userId, 'r')).toBe('scope');
    expect(await rowsFor()).toEqual([]);
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
    expect(await service(google).connectFromSignIn(userId, 'r-new')).toBe('disconnected');
    const [row] = await rowsFor();
    expect(row).toMatchObject({ isActive: false, refreshTokenEnc: null });
  });

  it('refuses a token Google rejects', async () => {
    const google = fakeGoogle();
    google.on(TOKEN, json(400, { error: 'invalid_grant' }));
    const err = await service(google)
      .connectFromSignIn(userId, 'stolen')
      .catch((e: unknown) => e);
    expect((err as GmailConnectError).reason).toBe('exchange');
  });
});
