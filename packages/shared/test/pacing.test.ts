import { describe, expect, it } from 'vitest';
import {
  campaignIntervalMs,
  deferTargetMs,
  estimateFinish,
  hourIndex,
  hourStartMs,
  resolveStart,
} from '../src/pacing.js';

const at = (iso: string) => Date.parse(iso);

describe('campaignIntervalMs', () => {
  it('uses the delay when it is the stricter constraint', () => {
    expect(campaignIntervalMs(60, 100)).toBe(60_000);
  });
  it('spreads the hourly limit evenly across the hour', () => {
    expect(campaignIntervalMs(2, 100)).toBe(36_000);
    expect(campaignIntervalMs(2, 1000)).toBe(3_600);
  });
  it('never goes below the delay even at the maximum hourly limit', () => {
    expect(campaignIntervalMs(1, 3600)).toBe(1_000);
    expect(campaignIntervalMs(2, 3600)).toBe(2_000);
  });
  it('rounds up so the campaign never exceeds its hourly limit', () => {
    expect(campaignIntervalMs(1, 7)).toBe(Math.ceil(3_600_000 / 7));
    expect(Math.floor(3_600_000 / campaignIntervalMs(1, 7))).toBeLessThanOrEqual(7);
  });
});

describe('hour windows', () => {
  it('maps a timestamp to its UTC hour and back', () => {
    const t = at('2026-10-25T14:59:59.999Z');
    expect(hourStartMs(hourIndex(t))).toBe(at('2026-10-25T14:00:00Z'));
    expect(hourIndex(at('2026-10-25T15:00:00Z'))).toBe(hourIndex(t) + 1);
  });
});

describe('deferTargetMs', () => {
  const next = hourIndex(at('2026-10-25T15:00:00Z'));
  it('places positions in order inside the next window', () => {
    expect(deferTargetMs(next, 1, 200, 2000)).toBe(at('2026-10-25T15:00:00Z'));
    expect(deferTargetMs(next, 3, 200, 2000)).toBe(at('2026-10-25T15:00:04Z'));
  });
  it('spills positions beyond the cap into later windows directly', () => {
    expect(deferTargetMs(next, 5, 5, 2000)).toBe(at('2026-10-25T15:00:08Z'));
    expect(deferTargetMs(next, 6, 5, 2000)).toBe(at('2026-10-25T16:00:00Z'));
    expect(deferTargetMs(next, 12, 5, 2000)).toBe(at('2026-10-25T17:00:02Z'));
  });
  it('bounds a window by what the spacing allows', () => {
    // A 2-minute spacing fits 30 sends in an hour, even though the cap is 200.
    expect(deferTargetMs(next, 31, 200, 120_000)).toBe(at('2026-10-25T16:00:00Z'));
  });
});

describe('resolveStart', () => {
  const now = at('2026-10-25T10:00:00Z');
  const grace = 5 * 60_000;
  it('keeps future start times', () => {
    expect(resolveStart(now + 1000, now, grace)).toEqual({ ok: true, startMs: now + 1000 });
  });
  it('treats a start inside the grace window as now', () => {
    expect(resolveStart(now - 4 * 60_000, now, grace)).toEqual({ ok: true, startMs: now });
    expect(resolveStart(now - grace, now, grace)).toEqual({ ok: true, startMs: now });
  });
  it('rejects anything older than the grace window', () => {
    expect(resolveStart(now - grace - 1, now, grace)).toEqual({ ok: false });
  });
});

describe('estimateFinish', () => {
  it('matches the 1,000-email example in tech-spec §9.5', () => {
    const r = estimateFinish({
      count: 1000,
      startMs: at('2026-10-25T14:00:00Z'),
      intervalMs: campaignIntervalMs(2, 1000),
      senderCount: 3,
      maxPerHourPerSender: 200,
      minSendGapMs: 2000,
    });
    expect(r.firstAtMs).toBe(at('2026-10-25T14:00:00Z'));
    expect(r.deferredCount).toBe(400);
    // Sender A has 334 emails: 200 in the 14:00 hour, 134 deferred to 15:00 at 2 s apart.
    expect(r.finishAtMs).toBe(at('2026-10-25T15:04:26Z'));
    expect(r.overCapacity).toBe(true);
    expect(r.capacityPerHour).toBe(600);
  });

  it("applies each sender's own cap when senderCaps is given", () => {
    const r = estimateFinish({
      count: 10,
      startMs: at('2026-10-25T14:00:00Z'),
      intervalMs: 1000,
      senderCount: 0,
      maxPerHourPerSender: 0,
      senderCaps: [2, 10],
      minSendGapMs: 1000,
      collect: true,
    });
    // Sender 0 gets emails 0, 2, 4, 6, 8: two fit its cap of 2 at 14:00, two more at 15:00, and
    // the last at 16:00. Sender 1 gets 1, 3, 5, 7, 9, all under its cap of 10.
    expect(r.deferredCount).toBe(3);
    expect(r.sends.filter((x) => x.deferred).every((x) => x.senderIndex === 0)).toBe(true);
    expect(r.capacityPerHour).toBe(12);
    expect(r.overCapacity).toBe(true);
    expect(r.finishAtMs).toBe(at('2026-10-25T16:00:00Z'));
  });

  it('does not defer anything when the plan fits under the caps', () => {
    const r = estimateFinish({
      count: 1240,
      startMs: at('2026-10-25T10:10:00Z'),
      intervalMs: campaignIntervalMs(2, 100),
      senderCount: 3,
      maxPerHourPerSender: 200,
      minSendGapMs: 2000,
    });
    expect(r.deferredCount).toBe(0);
    expect(r.overCapacity).toBe(false);
    expect(r.finishAtMs).toBe(at('2026-10-25T10:10:00Z') + 1239 * 36_000);
  });

  it('pushes sends apart when the per-sender gap is wider than the plan', () => {
    const r = estimateFinish({
      count: 4,
      startMs: 0,
      intervalMs: 1000,
      senderCount: 1,
      maxPerHourPerSender: 100,
      minSendGapMs: 5000,
      collect: true,
    });
    expect(r.sends.map((s) => s.sendAtMs)).toEqual([0, 5000, 10000, 15000]);
  });

  it('defers through several windows when the cap is tiny (acceptance test 5)', () => {
    const start = at('2026-10-25T10:00:00Z');
    const r = estimateFinish({
      count: 30,
      startMs: start,
      intervalMs: campaignIntervalMs(2, 3600),
      senderCount: 3,
      maxPerHourPerSender: 5,
      minSendGapMs: 2000,
      collect: true,
    });
    expect(r.deferredCount).toBe(15);
    const perWindow = new Map<string, number>();
    for (const s of r.sends) {
      const key = `${s.senderIndex}:${hourIndex(s.sendAtMs)}`;
      perWindow.set(key, (perWindow.get(key) ?? 0) + 1);
    }
    expect(Math.max(...perWindow.values())).toBeLessThanOrEqual(5);
    expect(r.finishAtMs).toBe(at('2026-10-25T11:00:08Z'));
  });

  it('counts sends that other campaigns already used this hour', () => {
    const start = at('2026-10-25T10:00:00Z');
    const r = estimateFinish({
      count: 3,
      startMs: start,
      intervalMs: 1000,
      senderCount: 1,
      maxPerHourPerSender: 2,
      minSendGapMs: 1000,
      existingUsage: [{ [hourIndex(start)]: 2 }],
    });
    expect(r.deferredCount).toBe(3);
    expect(r.firstAtMs).toBe(at('2026-10-25T11:00:00Z'));
  });

  it('returns nulls for an empty campaign', () => {
    const r = estimateFinish({
      count: 0,
      startMs: 0,
      intervalMs: 1000,
      senderCount: 1,
      maxPerHourPerSender: 10,
      minSendGapMs: 1000,
    });
    expect(r.firstAtMs).toBeNull();
    expect(r.finishAtMs).toBeNull();
  });

  it('handles the 5,000-recipient maximum quickly, even with a tiny cap', () => {
    const t0 = performance.now();
    const r = estimateFinish({
      count: 5000,
      startMs: 0,
      intervalMs: 1000,
      senderCount: 3,
      maxPerHourPerSender: 5,
      minSendGapMs: 2000,
    });
    expect(performance.now() - t0).toBeLessThan(100);
    // 15 per hour across 3 senders: 5,000 emails need 334 windows.
    expect(hourIndex(r.finishAtMs!)).toBe(333);
  });
});
