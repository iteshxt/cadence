import { randomUUID } from 'node:crypto';
import { hourIndex, hourStartMs } from '@cadence/shared';
import { UnrecoverableError, Worker } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { campaigns, emails, rateLimitEvents, senders } from '../src/db/schema.js';
import { createSendEmailProcessor } from '../src/jobs/sendEmail.processor.js';
import { createRedis } from '../src/queues/connection.js';
import { EMAIL_QUEUE, sendJobOptions, type SendJobData } from '../src/queues/emailQueue.js';
import { GmailError, type OutgoingEmail, type SendFn } from '../src/services/gmail.service.js';
import { reconcile } from '../src/services/reconciler.service.js';
import { recipients, resetState, seedSenders, seedUser, testContext, waitFor } from './helpers.js';

const ctx = testContext({ MIN_SEND_GAP_MS: '20', MAX_EMAILS_PER_HOUR_PER_SENDER: '200' });
const workerConn = createRedis(ctx.env.REDIS_URL);

let sent: OutgoingEmail[] = [];
let sendImpl: SendFn = async (_s, e) => {
  sent.push(e);
  return {
    messageId: `<${e.emailId}@cadence.local>`,
    previewUrl: `https://mail.google.com/mail/#all/${e.emailId}`,
  };
};

function startWorker(
  config: Partial<{ maxPerHourPerSender: number; leaseMs: number; concurrency: number }> = {},
) {
  return new Worker<SendJobData, void, string>(
    EMAIL_QUEUE,
    createSendEmailProcessor({
      db: ctx.db,
      repo: ctx.repo,
      rateLimiter: ctx.rateLimiter,
      send: (s, e) => sendImpl(s, e),
      notifyQueue: ctx.notifyQueue,
      log: ctx.log,
      config: {
        minSendGapMs: 20,
        maxPerHourPerSender: config.maxPerHourPerSender ?? 200,
        leaseMs: config.leaseMs ?? 120_000,
      },
    }),
    { connection: workerConn, concurrency: config.concurrency ?? 5, lockDuration: 30_000 },
  );
}

const statuses = (campaignId: string) =>
  ctx.db.select().from(emails).where(eq(emails.campaignId, campaignId)).orderBy(emails.seq);

let worker: Worker | undefined;

beforeAll(async () => {
  await ctx.emailQueue.waitUntilReady();
});
beforeEach(async () => {
  await resetState(ctx);
  await ctx.emailQueue.obliterate({ force: true });
  await ctx.notifyQueue.obliterate({ force: true });
  sent = [];
  sendImpl = async (_s, e) => {
    sent.push(e);
    return {
      messageId: `<${e.emailId}@cadence.local>`,
      previewUrl: `https://mail.google.com/mail/#all/${e.emailId}`,
    };
  };
});
afterEach(async () => {
  await worker?.close();
  worker = undefined;
});
afterAll(async () => {
  await workerConn.quit();
  await ctx.close();
});

async function schedule(
  userId: string,
  n: number,
  extra: Partial<{ hourlyLimit: number; startAt: string }> = {},
) {
  const r = await ctx.scheduler.create(userId, {
    subject: 'Quick question',
    body: 'Hello there',
    recipients: recipients(n, `${randomUUID().slice(0, 6)}-`),
    startAt: extra.startAt ?? new Date().toISOString(),
    delaySeconds: 1,
    hourlyLimit: extra.hourlyLimit ?? 3600,
  });
  return r.body;
}

describe('send pipeline', () => {
  it('sends every email exactly once, on time, and records the outcome', async () => {
    const user = await seedUser(ctx);
    await seedSenders(ctx, user.id, 3);
    const t0 = Date.now();
    const c = await schedule(user.id, 4);
    worker = startWorker();

    const rows = await waitFor(
      () => statuses(c.campaignId),
      (r) => r.every((e) => e.status === 'sent'),
    );
    expect(sent).toHaveLength(4);
    expect(new Set(sent.map((s) => s.emailId)).size).toBe(4);
    for (const row of rows) {
      expect(row.sentAt!.getTime()).toBeGreaterThanOrEqual(row.scheduledAt.getTime() - 250);
      expect(row.finishedAt).not.toBeNull();
      expect(row.previewUrl).toContain(row.id);
      expect(row.attempts).toBe(1);
    }
    // Planned one second apart (hourly limit 3,600 and a 1 s delay).
    expect(rows[3]!.scheduledAt.getTime() - rows[0]!.scheduledAt.getTime()).toBe(3000);
    expect(rows[0]!.scheduledAt.getTime()).toBeGreaterThanOrEqual(t0 - 1000);
  });

  it('never sends twice even if the same email has two jobs', async () => {
    const user = await seedUser(ctx);
    await seedSenders(ctx, user.id, 1);
    const c = await schedule(user.id, 1);
    const [row] = await statuses(c.campaignId);
    // A second job for the same email under a different job ID (e.g. a bug or a manual re-add).
    await ctx.emailQueue.add(
      'send',
      { emailId: row!.id },
      { ...sendJobOptions(row!.id, Date.now()), jobId: `dup-${row!.id}` },
    );
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    sendImpl = async (_s, e) => {
      sent.push(e);
      await gate;
      return { messageId: 'm', previewUrl: null };
    };
    worker = startWorker({ concurrency: 5 });
    await waitFor(
      async () => sent.length,
      (n) => n >= 1,
    );
    await new Promise((r) => setTimeout(r, 500));
    release();
    await waitFor(
      () => statuses(c.campaignId),
      (r) => r[0]?.status === 'sent',
    );
    expect(sent).toHaveLength(1);
  });

  it('allows exactly one winner when many workers claim the same row', async () => {
    const user = await seedUser(ctx);
    await seedSenders(ctx, user.id, 1);
    const c = await schedule(user.id, 1, {
      startAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const [row] = await statuses(c.campaignId);
    const claims = await Promise.all(Array.from({ length: 10 }, () => ctx.repo.claim(row!.id)));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});

describe('rate limits and deferral', () => {
  it('defers overflow to the next hour in order, alerts once per sender, and never fails a job', async () => {
    const user = await seedUser(ctx);
    const senderRows = await seedSenders(ctx, user.id, 3);
    const c = await schedule(user.id, 9);
    worker = startWorker({ maxPerHourPerSender: 2 });

    const rows = await waitFor(
      () => statuses(c.campaignId),
      (r) =>
        r.filter((e) => e.status === 'sent').length === 6 &&
        r.filter((e) => e.status === 'deferred').length === 3,
    );
    const deferred = rows.filter((r) => r.status === 'deferred');
    const nextHour = hourIndex(rows[0]!.scheduledAt.getTime()) + 1;
    for (const d of deferred) {
      expect(d.deferScope).toBe('sender');
      expect(d.deferLimit).toBe(2);
      expect(hourIndex(d.nextAttemptAt.getTime())).toBe(nextHour);
      expect(d.nextAttemptAt.getTime()).toBe(hourStartMs(nextHour)); // first position for each sender
    }
    // The last email of each sender is the one deferred (planned order kept).
    expect(deferred.map((d) => d.seq).sort((a, b) => a - b)).toEqual([6, 7, 8]);

    const notifications = await ctx.notifyQueue.getJobs([
      'waiting',
      'delayed',
      'active',
      'completed',
    ]);
    expect(notifications).toHaveLength(3);
    expect(new Set(notifications.map((j) => j.data.senderId))).toEqual(
      new Set(senderRows.map((s) => s.id)),
    );

    const events = await ctx.db.select().from(rateLimitEvents);
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.notified && e.scope === 'sender')).toBe(true);

    // Deferred jobs sit in Redis as delayed jobs; none failed.
    expect(await ctx.emailQueue.getFailedCount()).toBe(0);
    expect(await ctx.emailQueue.getDelayedCount()).toBe(3);
  });
});

describe('per-sender limits', () => {
  it("enforces each sender's own hourly limit under the server maximum", async () => {
    const user = await seedUser(ctx);
    await seedSenders(ctx, user.id, 1, { hourlyLimit: 2 });
    const c = await schedule(user.id, 3);
    worker = startWorker({ maxPerHourPerSender: 200 });
    const rows = await waitFor(
      () => statuses(c.campaignId),
      (r) =>
        r.filter((e) => e.status === 'sent').length === 2 &&
        r.filter((e) => e.status === 'deferred').length === 1,
    );
    expect(rows[2]!.deferLimit).toBe(2);
  });
});

describe('failures', () => {
  it('retries an error where Gmail certainly did not accept the message, then sends once', async () => {
    const user = await seedUser(ctx);
    await seedSenders(ctx, user.id, 1);
    const c = await schedule(user.id, 1);
    let calls = 0;
    sendImpl = async (_s, e) => {
      calls++;
      if (calls === 1) throw new GmailError('Couldn’t reach Gmail (ECONNREFUSED)', 'retryable');
      sent.push(e);
      return { messageId: 'm', previewUrl: null };
    };
    worker = startWorker();
    const [row] = await waitFor(
      () => statuses(c.campaignId),
      (r) => r[0]?.status === 'sent',
      20_000,
    );
    expect(calls).toBe(2);
    expect(row!.attempts).toBe(2);
  });

  it('does not retry an error where Gmail may have accepted the message', async () => {
    const user = await seedUser(ctx);
    await seedSenders(ctx, user.id, 1);
    const c = await schedule(user.id, 1);
    let calls = 0;
    sendImpl = async () => {
      calls++;
      throw new GmailError('Gmail returned 500', 'ambiguous');
    };
    worker = startWorker();
    const [row] = await waitFor(
      () => statuses(c.campaignId),
      (r) => r[0]?.status === 'failed',
    );
    expect(calls).toBe(1);
    expect(row!.error).toBe('ambiguous: Gmail returned 500');
    await waitFor(
      () => ctx.emailQueue.getFailedCount(),
      (n) => n === 1,
    );
  });

  it("fails a disconnected sender's email without sending it from another account", async () => {
    const user = await seedUser(ctx);
    const [gone] = await seedSenders(ctx, user.id, 2);
    const c = await schedule(user.id, 2);
    await ctx.db.update(senders).set({ isActive: false }).where(eq(senders.id, gone!.id));
    worker = startWorker();
    const rows = await waitFor(
      () => statuses(c.campaignId),
      (r) => r.every((e) => e.status === 'sent' || e.status === 'failed'),
    );
    expect(rows.map((r) => r.status)).toEqual(['failed', 'sent']);
    expect(rows[0]!.error).toBe('sender disconnected');
    expect(sent).toHaveLength(1);
  });

  it('marks an expired claim as interrupted instead of resending', async () => {
    const user = await seedUser(ctx);
    await seedSenders(ctx, user.id, 1);
    const c = await schedule(user.id, 1);
    const [row] = await statuses(c.campaignId);
    await ctx.db
      .update(emails)
      .set({ status: 'sending', claimedAt: sql`now() - interval '10 minutes'` })
      .where(eq(emails.id, row!.id));
    worker = startWorker();
    const [after] = await waitFor(
      () => statuses(c.campaignId),
      (r) => r[0]?.status === 'failed',
    );
    expect(after!.error).toBe('interrupted');
    expect(sent).toHaveLength(0);
  });

  it('waits out a live lease instead of leaving the row stuck in sending', async () => {
    const user = await seedUser(ctx);
    await seedSenders(ctx, user.id, 1);
    const c = await schedule(user.id, 1);
    const [row] = await statuses(c.campaignId);
    await ctx.db
      .update(emails)
      .set({ status: 'sending', claimedAt: sql`now()` })
      .where(eq(emails.id, row!.id));
    worker = startWorker({ leaseMs: 1500 });
    await waitFor(
      () => ctx.emailQueue.getDelayedCount(),
      (n) => n === 1,
    );
    const [after] = await waitFor(
      () => statuses(c.campaignId),
      (r) => r[0]?.status === 'failed',
      10_000,
    );
    expect(after!.error).toBe('interrupted');
    expect(sent).toHaveLength(0);
  });
});

describe('reconciler', () => {
  it('re-adds missing jobs, replaces stale failed jobs, and fails expired claims', async () => {
    const user = await seedUser(ctx);
    await seedSenders(ctx, user.id, 1);
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const c = await schedule(user.id, 3, { startAt: later });
    const [a, b, d] = await statuses(c.campaignId);

    // a: job lost (e.g. Redis wiped)
    await ctx.emailQueue.remove(a!.id);
    // b: job ended up failed in BullMQ while the row is still scheduled
    await ctx.emailQueue.remove(b!.id);
    await ctx.emailQueue.add('send', { emailId: b!.id }, { jobId: b!.id, attempts: 1 });
    const failer = new Worker(
      EMAIL_QUEUE,
      async () => {
        throw new UnrecoverableError('boom');
      },
      { connection: workerConn },
    );
    await waitFor(
      () => ctx.emailQueue.getFailedCount(),
      (n) => n === 1,
    );
    await failer.close();
    // d: claimed long ago and never finished
    await ctx.db
      .update(emails)
      .set({ status: 'sending', claimedAt: sql`now() - interval '1 hour'` })
      .where(eq(emails.id, d!.id));

    const summary = await reconcile({
      redis: ctx.redis,
      emailQueue: ctx.emailQueue,
      repo: ctx.repo,
      log: ctx.log,
      leaseMs: 120_000,
    });
    expect(summary).toEqual({ requeued: 2, replaced: 1, interrupted: 1 });
    expect(await ctx.emailQueue.getJob(a!.id).then((j) => j?.getState())).toBe('delayed');
    expect(await ctx.emailQueue.getJob(b!.id).then((j) => j?.getState())).toBe('delayed');
    const [, , dAfter] = await statuses(c.campaignId);
    expect(dAfter!.status).toBe('failed');

    // Running it again changes nothing.
    expect(
      await reconcile({
        redis: ctx.redis,
        emailQueue: ctx.emailQueue,
        repo: ctx.repo,
        log: ctx.log,
        leaseMs: 120_000,
      }),
    ).toEqual({ requeued: 0, replaced: 0, interrupted: 0 });
  });

  it('only one process runs it at a time', async () => {
    await ctx.redis.set('reconcile:lock', 'someone-else', 'EX', 60);
    const summary = await reconcile({
      redis: ctx.redis,
      emailQueue: ctx.emailQueue,
      repo: ctx.repo,
      log: ctx.log,
      leaseMs: 120_000,
    });
    expect(summary.skipped).toBe('locked');
  });
});

describe('campaign creation', () => {
  it('accepts 5,000 recipients in well under 3 seconds', async () => {
    const user = await seedUser(ctx);
    await seedSenders(ctx, user.id, 3);
    const t0 = performance.now();
    const c = await schedule(user.id, 5000, { hourlyLimit: 100 });
    const ms = performance.now() - t0;
    expect(c.scheduled).toBe(5000);
    expect(c.intervalSeconds).toBe(36);
    expect(ms).toBeLessThan(3000);
    const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(emails);
    expect(count!.n).toBe(5000);
    expect(await ctx.emailQueue.getDelayedCount()).toBeGreaterThanOrEqual(4999);
    const [camp] = await ctx.db.select().from(campaigns).where(eq(campaigns.id, c.campaignId));
    expect(camp!.intervalMs).toBe(36_000);
  });
});

describe('limit notifications', () => {
  it('frees the hour when Slack is not connected, so a reconnect alerts on the next hit', async () => {
    const { createNotifyProcessor } = await import('../src/jobs/notify.processor.js');
    const user = await seedUser(ctx);
    const [sender] = await seedSenders(ctx, user.id, 1);
    const hour = hourIndex(Date.now());
    const posted: string[] = [];
    let connected = false;
    const processor = createNotifyProcessor({
      db: ctx.db,
      repo: ctx.repo,
      rateLimiter: ctx.rateLimiter,
      log: ctx.log,
      slack: {
        post: async (_userId, message) => {
          if (!connected) return 'not-connected';
          posted.push(message.text);
          return 'sent';
        },
      },
    });
    const job = {
      data: { kind: 'sender-limit', userId: user.id, senderId: sender!.id, hour, cap: 200 },
    };

    // Disconnected: the claim is released, nothing is posted, nothing throws.
    expect(await ctx.rateLimiter.claimNotification(user.id, sender!.id, hour)).toBe(true);
    await processor(job as never);
    expect(posted).toHaveLength(0);

    // Reconnected: the next limit hit in the same hour claims again and posts.
    connected = true;
    expect(await ctx.rateLimiter.claimNotification(user.id, sender!.id, hour)).toBe(true);
    await processor(job as never);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatch(/^⚠️ Sender A reached its hourly limit \(200 of 200\)\./);

    // Delivered: the hour stays claimed (one alert per sender per hour).
    expect(await ctx.rateLimiter.claimNotification(user.id, sender!.id, hour)).toBe(false);
  });
});

describe('slack service', () => {
  it('connects with a signed state, posts at send time, and drops a dead webhook', async () => {
    const { createSlack } = await import('../src/services/slack.service.js');
    const user = await seedUser(ctx);
    const calls: string[] = [];
    let hookStatus = 200;
    const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/oauth.v2.access')) {
        return Response.json({
          ok: true,
          access_token: 'xoxb-test',
          team: { id: 'T1', name: 'Acme' },
          incoming_webhook: { channel: '#outreach-alerts', url: 'https://hooks.slack.test/abc' },
        });
      }
      if (url.startsWith('https://hooks.slack.test/')) {
        expect(JSON.parse(String(init?.body)).text).toBe('hello');
        return new Response(hookStatus === 200 ? 'ok' : 'no_service', { status: hookStatus });
      }
      return Response.json({ ok: true });
    }) as typeof fetch;
    const slack = createSlack({
      db: ctx.db,
      crypto: ctx.crypto,
      log: ctx.log,
      fetch: fakeFetch,
      env: {
        SLACK_CLIENT_ID: 'id',
        SLACK_CLIENT_SECRET: 'secret',
        SLACK_REDIRECT_URI: 'http://localhost:4000/api/integrations/slack/callback',
        STATE_SECRET: ctx.env.STATE_SECRET,
      },
    });

    const url = new URL(await slack.authorizeUrl(user.id));
    expect(url.searchParams.get('scope')).toBe('incoming-webhook,chat:write');
    const state = url.searchParams.get('state')!;
    await expect(slack.completeOAuth('code', `${state}tampered`)).rejects.toThrow(/expired/);
    expect(await slack.completeOAuth('code', state)).toBe(user.id);
    expect(await slack.status(user.id)).toEqual({
      connected: true,
      teamName: 'Acme',
      channelName: 'outreach-alerts',
    });

    expect(await slack.post(user.id, { text: 'hello' })).toBe('sent');
    hookStatus = 404;
    expect(await slack.post(user.id, { text: 'hello' })).toBe('disconnected');
    expect(await slack.status(user.id)).toEqual({ connected: false });
    expect(await slack.post(user.id, { text: 'hello' })).toBe('not-connected');
  });
});
