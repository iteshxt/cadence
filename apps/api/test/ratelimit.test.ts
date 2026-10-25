import { hourIndex } from '@cadence/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { createRedis } from '../src/queues/connection.js';
import { createEmailQueue, sendJobOptions } from '../src/queues/emailQueue.js';
import { createRateLimiter } from '../src/services/ratelimit.service.js';

const redis = createRedis(inject('redisUrl'));
const rl = createRateLimiter(redis);
const HOUR = 3_600_000;

beforeEach(async () => {
  await redis.flushdb();
});
afterAll(async () => {
  await redis.quit();
});

const base = {
  senderId: 's1',
  campaignId: 'c1',
  senderLimit: 10,
  campaignLimit: 1000,
  minGapMs: 2000,
};

describe('reserve_send.lua', () => {
  it('never exceeds the sender cap under 50 parallel calls', async () => {
    const now = Date.UTC(2026, 9, 25, 10, 0, 0);
    const results = await Promise.all(
      Array.from({ length: 50 }, () => rl.reserve({ ...base, nowMs: now, minGapMs: 1 })),
    );
    const ok = results.filter((r) => r.kind === 'ok');
    expect(ok).toHaveLength(10);
    expect(results.filter((r) => r.kind === 'limit' && r.scope === 'sender')).toHaveLength(40);
    expect(await redis.get(`rl:s:s1:${hourIndex(now)}`)).toBe('10');
  });

  it('hands out distinct slots at least the minimum gap apart', async () => {
    const now = Date.UTC(2026, 9, 25, 10, 0, 0);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => rl.reserve({ ...base, nowMs: now })),
    );
    const slots = results.map((r) => (r.kind === 'ok' ? r.slotAt : -1)).sort((a, b) => a - b);
    expect(slots[0]).toBe(now);
    for (let i = 1; i < slots.length; i++) expect(slots[i]! - slots[i - 1]!).toBe(2000);
  });

  it('charges the cap to the hour of the slot, not of now', async () => {
    const now = Date.UTC(2026, 9, 25, 10, 59, 59);
    const a = await rl.reserve({ ...base, nowMs: now });
    const b = await rl.reserve({ ...base, nowMs: now });
    expect(a).toEqual({ kind: 'ok', slotAt: now });
    expect(b.kind === 'ok' && hourIndex(b.slotAt)).toBe(hourIndex(now) + 1);
    expect(await redis.get(`rl:s:s1:${hourIndex(now) + 1}`)).toBe('1');
  });

  it('reports the campaign scope when the campaign cap is the one hit', async () => {
    const now = Date.UTC(2026, 9, 25, 10, 0, 0);
    await rl.reserve({ ...base, nowMs: now, campaignLimit: 1, minGapMs: 1 });
    const r = await rl.reserve({ ...base, nowMs: now + 10, campaignLimit: 1, minGapMs: 1 });
    expect(r).toEqual({ kind: 'limit', scope: 'campaign', hour: hourIndex(now) });
  });

  it('does not move the gap pointer when a limit is hit', async () => {
    const now = Date.UTC(2026, 9, 25, 10, 0, 0);
    await rl.reserve({ ...base, nowMs: now, senderLimit: 1 });
    const before = await redis.get('gap:s:s1');
    await rl.reserve({ ...base, nowMs: now + 1, senderLimit: 1 });
    expect(await redis.get('gap:s:s1')).toBe(before);
  });
});

describe('deferral bookkeeping', () => {
  it('hands out monotonic positions per window', async () => {
    const h = hourIndex(Date.now()) + 1;
    const positions = await Promise.all(
      Array.from({ length: 20 }, () => rl.takeDeferPosition('sender', 's1', h)),
    );
    expect([...positions].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
  });

  it('allows one notification per user, sender, and hour', async () => {
    const h = 494182;
    expect(await rl.claimNotification('u', 's', h)).toBe(true);
    expect(await rl.claimNotification('u', 's', h)).toBe(false);
    expect(await rl.claimNotification('u', 's', h + 1)).toBe(true);
    expect(await rl.claimNotification('u2', 's', h)).toBe(true);
  });

  it('reads usage for several senders at once', async () => {
    const now = Date.UTC(2026, 9, 25, 10, 0, 0);
    await rl.reserve({ ...base, nowMs: now, minGapMs: 1 });
    await rl.reserve({ ...base, nowMs: now + 5, minGapMs: 1 });
    const usage = await rl.senderUsage(['s1', 's2'], hourIndex(now));
    expect(usage.get('s1')).toBe(2);
    expect(usage.get('s2')).toBe(0);
    expect(HOUR).toBeGreaterThan(0);
  });
});

describe('BullMQ job ID deduplication', () => {
  it('keeps a single job when the same email is added twice', async () => {
    const queue = createEmailQueue(redis);
    const id = '6f1c0f7e-4c49-4bd8-9a5e-6d1a2b3c4d5e';
    const job = {
      name: 'send' as const,
      data: { emailId: id },
      opts: sendJobOptions(id, Date.now() + 60_000),
    };
    await queue.addBulk([job]);
    await queue.addBulk([job, job]);
    expect(await queue.getDelayedCount()).toBe(1);
    await queue.close();
  });
});
