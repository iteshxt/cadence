import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { VerifyToken } from '../src/middleware/auth.js';
import { profiles } from '../src/db/schema.js';
import { recipients, resetState, seedSenders, testContext } from './helpers.js';

const ctx = testContext();

/** Test tokens look like `test:<userId>:<email>`; anything else is rejected like a bad JWT. */
const verify: VerifyToken = async (token) => {
  const [kind, sub, email] = token.split(':');
  if (kind !== 'test' || !sub || !email) throw new Error('bad token');
  return {
    sub,
    email,
    user_metadata: { full_name: 'Test User', avatar_url: 'https://example.com/a.png' },
  };
};
const app = createApp(ctx, { verify, bullBoard: true });

// Fresh users per test: resetState truncates profiles, but the auth middleware caches upserts.
let alice = { id: randomUUID(), email: 'alice@example.com' };
let bob = { id: randomUUID(), email: 'bob@example.com' };
const auth = (u: { id: string; email: string }) => ({
  Authorization: `Bearer test:${u.id}:${u.email}`,
});

const campaign = (over: Record<string, unknown> = {}) => ({
  subject: 'Quick question',
  body: 'Hi there',
  recipients: recipients(3),
  startAt: new Date(Date.now() + 60_000).toISOString(),
  delaySeconds: 2,
  hourlyLimit: 100,
  ...over,
});

beforeEach(async () => {
  alice = { id: randomUUID(), email: 'alice@example.com' };
  bob = { id: randomUUID(), email: 'bob@example.com' };
  await resetState(ctx);
  await ctx.emailQueue.obliterate({ force: true });
  // Alice has three connected Gmail senders; Bob has none.
  await ctx.db.insert(profiles).values([
    { id: alice.id, email: alice.email },
    { id: bob.id, email: bob.email },
  ]);
  await seedSenders(ctx, alice.id, 3);
});
afterAll(async () => {
  await ctx.close();
});

describe('auth', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an invalid token with a clear message', async () => {
    const res = await request(app).get('/api/me').set('Authorization', 'Bearer nope');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/session has expired/);
  });

  it('upserts the profile and returns it', async () => {
    const res = await request(app).get('/api/me').set(auth(alice));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: alice.id,
      email: alice.email,
      fullName: 'Test User',
      avatarUrl: 'https://example.com/a.png',
    });
  });
});

describe('POST /api/campaigns', () => {
  it('creates a campaign without a prior /me call (profile upserted by middleware)', async () => {
    const res = await request(app).post('/api/campaigns').set(auth(alice)).send(campaign());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ scheduled: 3, intervalSeconds: 36 });
    expect(Date.parse(res.body.estimatedFinishAt)).toBeGreaterThan(Date.parse(res.body.firstAt));
  });

  it('returns field errors for invalid input', async () => {
    const res = await request(app)
      .post('/api/campaigns')
      .set(auth(alice))
      .send(campaign({ subject: ' ', recipients: ['not-an-email'] }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fields.subject).toBe('Subject is required');
    expect(res.body.error.details.fields['recipients.0']).toBe('Not a valid email address');
  });

  it('treats a start a minute ago as now, and rejects one an hour ago', async () => {
    const ok = await request(app)
      .post('/api/campaigns')
      .set(auth(alice))
      .send(campaign({ startAt: new Date(Date.now() - 60_000).toISOString() }));
    expect(ok.status).toBe(201);
    expect(Date.parse(ok.body.firstAt)).toBeGreaterThan(Date.now() - 10_000);

    const late = await request(app)
      .post('/api/campaigns')
      .set(auth(alice))
      .send(campaign({ startAt: new Date(Date.now() - 3_600_000).toISOString() }));
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('START_IN_PAST');
  });

  it('creates one campaign when the same Idempotency-Key is sent twice', async () => {
    const key = randomUUID();
    const first = await request(app)
      .post('/api/campaigns')
      .set(auth(alice))
      .set('Idempotency-Key', key)
      .send(campaign());
    const second = await request(app)
      .post('/api/campaigns')
      .set(auth(alice))
      .set('Idempotency-Key', key)
      .send(campaign());
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_REQUEST');
    expect(second.body.error.details.campaignId).toBe(first.body.campaignId);
    const list = await request(app).get('/api/campaigns').set(auth(alice));
    expect(list.body.items).toHaveLength(1);
  });

  it('handles a double-click race with one campaign', async () => {
    const key = randomUUID();
    const [a, b] = await Promise.all([
      request(app)
        .post('/api/campaigns')
        .set(auth(alice))
        .set('Idempotency-Key', key)
        .send(campaign()),
      request(app)
        .post('/api/campaigns')
        .set(auth(alice))
        .set('Idempotency-Key', key)
        .send(campaign()),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await ctx.emailQueue.getDelayedCount()).toBe(3);
  });

  it('round-robins recipients across the chosen senders only', async () => {
    const senders = (await request(app).get('/api/senders').set(auth(alice))).body.items as {
      id: string;
      label: string;
    }[];
    const res = await request(app)
      .post('/api/campaigns')
      .set(auth(alice))
      .send(campaign({ recipients: recipients(4), senderIds: [senders[0]!.id, senders[2]!.id] }));
    expect(res.status).toBe(201);
    const page = await request(app).get('/api/emails?view=scheduled').set(auth(alice));
    expect(page.body.items.map((i: { senderLabel: string }) => i.senderLabel)).toEqual([
      'Sender A',
      'Sender C',
      'Sender A',
      'Sender C',
    ]);
  });
});

describe('reading emails', () => {
  it('paginates with cursors and reports the total', async () => {
    await request(app)
      .post('/api/campaigns')
      .set(auth(alice))
      .send(campaign({ recipients: recipients(30) }));
    const p1 = await request(app).get('/api/emails?view=scheduled').set(auth(alice));
    expect(p1.body.items).toHaveLength(25);
    expect(p1.body.total).toBe(30);
    const p2 = await request(app)
      .get(`/api/emails?view=scheduled&cursor=${p1.body.nextCursor}`)
      .set(auth(alice));
    expect(p2.body.items).toHaveLength(5);
    expect(p2.body.nextCursor).toBeNull();
    const all = [...p1.body.items, ...p2.body.items].map((i: { nextAttemptAt: string }) =>
      Date.parse(i.nextAttemptAt),
    );
    expect(all).toEqual([...all].sort((x, y) => x - y));
  });

  it("never shows one user's emails to another", async () => {
    const created = await request(app).post('/api/campaigns').set(auth(alice)).send(campaign());
    expect(created.status).toBe(201);
    const aliceEmails = await request(app).get('/api/emails?view=scheduled').set(auth(alice));
    const id = aliceEmails.body.items[0].id;

    const bobList = await request(app).get('/api/emails?view=scheduled').set(auth(bob));
    expect(bobList.body.items).toHaveLength(0);
    expect(bobList.body.total).toBe(0);
    expect((await request(app).get(`/api/emails/${id}`).set(auth(bob))).status).toBe(404);
    expect((await request(app).post(`/api/emails/${id}/cancel`).set(auth(bob))).status).toBe(404);
    expect((await request(app).get('/api/stats').set(auth(bob))).body.scheduled).toBe(0);
  });

  it('cancels a scheduled email and removes its job', async () => {
    await request(app)
      .post('/api/campaigns')
      .set(auth(alice))
      .send(campaign({ recipients: recipients(1) }));
    const [item] = (await request(app).get('/api/emails?view=scheduled').set(auth(alice))).body
      .items;
    const res = await request(app).post(`/api/emails/${item.id}/cancel`).set(auth(alice));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    expect(await ctx.emailQueue.getJob(item.id)).toBeUndefined();
    const again = await request(app).post(`/api/emails/${item.id}/cancel`).set(auth(alice));
    expect(again.status).toBe(409);
  });

  it('reports stats and timeline buckets', async () => {
    await request(app)
      .post('/api/campaigns')
      .set(auth(alice))
      .send(campaign({ recipients: recipients(5) }));
    const stats = await request(app).get('/api/stats').set(auth(alice));
    expect(stats.body).toMatchObject({ scheduled: 5, deferred: 0, sentTotal: 0 });
    expect(stats.body.nextSendAt).not.toBeNull();

    const from = new Date(Date.now() - 900_000).toISOString();
    const to = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const tl = await request(app).get(`/api/timeline?from=${from}&to=${to}`).set(auth(alice));
    expect(tl.status).toBe(200);
    expect(tl.body.bucketMs).toBe(30_000);
    expect(tl.body.senders).toHaveLength(3);
    const scheduled = tl.body.buckets.reduce(
      (n: number, b: { scheduled: number }) => n + b.scheduled,
      0,
    );
    expect(scheduled).toBe(5);
    expect(tl.body.windows.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects a timeline range over 24 hours', async () => {
    const res = await request(app)
      .get('/api/timeline?from=2026-10-25T00:00:00Z&to=2026-10-27T00:00:00Z')
      .set(auth(alice));
    expect(res.status).toBe(400);
  });
});

describe('senders and settings', () => {
  const firstSender = async () =>
    (await request(app).get('/api/senders').set(auth(alice))).body.items[0] as { id: string };

  it('edits a sender within the server maximum', async () => {
    const { id } = await firstSender();
    const res = await request(app)
      .patch(`/api/senders/${id}`)
      .set(auth(alice))
      .send({ label: ' Sales ', displayName: 'Alice from Acme', hourlyLimit: 25 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ label: 'Sales', displayName: 'Alice from Acme', cap: 25 });

    const tooHigh = await request(app)
      .patch(`/api/senders/${id}`)
      .set(auth(alice))
      .send({ hourlyLimit: 201 });
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.body.error.details.fields.hourlyLimit).toMatch(/at most 200/);
  });

  it("never lets one user edit, disconnect, or send from another user's sender", async () => {
    const { id } = await firstSender();
    expect(
      (await request(app).patch(`/api/senders/${id}`).set(auth(bob)).send({ label: 'Mine' }))
        .status,
    ).toBe(404);
    expect((await request(app).delete(`/api/senders/${id}`).set(auth(bob))).status).toBe(404);
    const res = await request(app)
      .post('/api/campaigns')
      .set(auth(bob))
      .send(campaign({ senderIds: [id] }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fields.senderIds).toBeDefined();
  });

  it('refuses a campaign until the user connects a sender', async () => {
    const res = await request(app).post('/api/campaigns').set(auth(bob)).send(campaign());
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NO_SENDERS');
    expect(res.body.error.message).toMatch(/Connect a Gmail account/);
  });

  it('disconnects a sender, which then disappears from the list', async () => {
    const { id } = await firstSender();
    expect((await request(app).delete(`/api/senders/${id}`).set(auth(alice))).status).toBe(204);
    const list = (await request(app).get('/api/senders').set(auth(alice))).body.items;
    expect(list.map((s: { id: string }) => s.id)).not.toContain(id);
    expect((await request(app).delete(`/api/senders/${id}`).set(auth(alice))).status).toBe(404);
  });

  it('saves Compose defaults', async () => {
    expect((await request(app).get('/api/settings').set(auth(alice))).body).toEqual({
      defaultDelaySeconds: 2,
      defaultHourlyLimit: 100,
    });
    const saved = await request(app)
      .put('/api/settings')
      .set(auth(alice))
      .send({ defaultDelaySeconds: 5, defaultHourlyLimit: 60 });
    expect(saved.status).toBe(200);
    expect((await request(app).get('/api/settings').set(auth(alice))).body).toEqual({
      defaultDelaySeconds: 5,
      defaultHourlyLimit: 60,
    });
    const bad = await request(app)
      .put('/api/settings')
      .set(auth(alice))
      .send({ defaultDelaySeconds: 0, defaultHourlyLimit: 60 });
    expect(bad.status).toBe(400);
  });

  it('validates the Gmail connect call and refuses it when Gmail is not configured', async () => {
    const bad = await request(app)
      .post('/api/integrations/gmail/connect')
      .set(auth(alice))
      .send({});
    expect(bad.status).toBe(400);
    const res = await request(app)
      .post('/api/integrations/gmail/connect')
      .set(auth(alice))
      .send({ refreshToken: 'r' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('GMAIL_ERROR');
    expect((await request(app).post('/api/integrations/gmail/connect').send({})).status).toBe(401);
  });
});

describe('platform', () => {
  it('serves config without secrets', async () => {
    const res = await request(app).get('/api/config').set(auth(alice));
    expect(res.body).toEqual({
      workerConcurrency: 5,
      minSendGapMs: 2000,
      maxPerHourPerSender: 200,
      maxRecipients: 5000,
      startGraceMs: 300000,
    });
  });

  it("lists only the user's own senders, without tokens", async () => {
    const res = await request(app).get('/api/senders').set(auth(alice));
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items[0]).toMatchObject({ label: 'Sender A', cap: 200, status: 'connected' });
    expect(JSON.stringify(res.body)).not.toMatch(/token|refresh/i);
    expect((await request(app).get('/api/senders').set(auth(bob))).body.items).toEqual([]);
  });

  it('reports health, degraded when search is down', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'degraded',
      checks: { db: true, redis: true, search: false },
    });
  });

  it('protects Bull Board with basic auth', async () => {
    expect((await request(app).get('/admin/queues')).status).toBe(401);
    const ok = await request(app).get('/admin/queues').auth('admin', 'test-password');
    expect(ok.status).toBe(200);
  });

  it('returns Slack status and refuses to connect when Slack is not configured', async () => {
    expect((await request(app).get('/api/integrations/slack').set(auth(alice))).body).toEqual({
      connected: false,
    });
    const res = await request(app).post('/api/integrations/slack/authorize').set(auth(alice));
    expect(res.status).toBe(503);
    const test = await request(app).post('/api/integrations/slack/test').set(auth(alice));
    expect(test.status).toBe(409);
  });

  it('sends Slack callback errors back to Settings', async () => {
    const res = await request(app).get('/api/integrations/slack/callback?error=access_denied');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('http://localhost:3000/dashboard/settings?slack=cancelled');
  });

  it('answers unknown routes with the standard error shape', async () => {
    const res = await request(app).get('/api/nope').set(auth(alice));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
