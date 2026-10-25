import {
  HOUR_MS,
  LIMITS,
  hourIndex,
  hourStartMs,
  type Timeline,
  type TimelineBucket,
} from '@cadence/shared';
import { and, asc, eq, gte, inArray, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { emails, senders } from '../db/schema.js';
import type { RateLimiter } from './ratelimit.service.js';
import { senderCap } from './senders.service.js';

const BUCKET_STEPS_MS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900].map((s) => s * 1000);

/** Smallest "nice" bucket that keeps each lane at or under the bucket budget. */
export function pickBucketMs(
  rangeMs: number,
  maxBuckets: number = LIMITS.TIMELINE_MAX_BUCKETS,
): number {
  return BUCKET_STEPS_MS.find((b) => rangeMs / b <= maxBuckets) ?? BUCKET_STEPS_MS.at(-1)!;
}

export interface TimelineDeps {
  db: Db;
  rateLimiter: RateLimiter;
  /** The server maximum; each sender's own limit is clamped to it. */
  maxPerHourPerSender: number;
  now?: () => number;
}

export function createTimeline(deps: TimelineDeps) {
  const now = deps.now ?? Date.now;

  return {
    async get(userId: string, fromIso: string, toIso: string): Promise<Timeline> {
      const from = new Date(fromIso);
      const to = new Date(toIso);
      const bucketMs = pickBucketMs(to.getTime() - from.getTime());

      // Pending emails sit at their planned time; finished ones at the time they finished.
      const ts = sql`case when ${emails.status} in ('scheduled', 'deferred', 'sending') then ${emails.nextAttemptAt} else ${emails.finishedAt} end`;
      // Inlined (not a bind parameter) so SELECT and GROUP BY see the identical expression.
      // bucketMs always comes from BUCKET_STEPS_MS, never from the request.
      const bucket = sql<number>`floor(extract(epoch from ${ts}) * 1000 / ${sql.raw(String(Math.trunc(bucketMs)))})::bigint`;
      const rows = await deps.db
        .select({
          senderId: emails.senderId,
          bucket,
          status: emails.status,
          n: sql<number>`count(*)::int`,
        })
        .from(emails)
        .where(
          and(
            eq(emails.userId, userId),
            inArray(emails.status, ['scheduled', 'deferred', 'sending', 'sent', 'failed']),
            sql`${ts} >= ${from.toISOString()}::timestamptz`,
            sql`${ts} < ${to.toISOString()}::timestamptz`,
          ),
        )
        .groupBy(emails.senderId, bucket, emails.status);

      // Lanes: the user's active senders, plus any sender (since disconnected) with emails in range.
      const inRange = [...new Set(rows.map((r) => r.senderId))];
      const laneRows = await deps.db
        .select({ id: senders.id, label: senders.label, hourlyLimit: senders.hourlyLimit })
        .from(senders)
        .where(
          or(
            and(eq(senders.userId, userId), eq(senders.isActive, true)),
            inRange.length > 0 ? inArray(senders.id, inRange) : undefined,
          ),
        )
        .orderBy(asc(senders.label), asc(senders.id));
      const lanes = laneRows.map((r) => ({
        id: r.id,
        label: r.label,
        cap: senderCap(r, deps.maxPerHourPerSender),
      }));

      const buckets = new Map<string, TimelineBucket>();
      for (const r of rows) {
        const t = Number(r.bucket) * bucketMs;
        const key = `${r.senderId}:${t}`;
        let b = buckets.get(key);
        if (!b) {
          b = {
            senderId: r.senderId,
            t: new Date(t).toISOString(),
            scheduled: 0,
            sending: 0,
            deferred: 0,
            sent: 0,
            failed: 0,
          };
          buckets.set(key, b);
        }
        if (r.status !== 'cancelled') b[r.status] += r.n;
      }

      // Per-sender usage of each hour window in range. Recent and future hours come from the
      // Redis counters; older hours, whose counters have expired, are counted from Postgres.
      const firstHour = hourIndex(from.getTime());
      const lastHour = hourIndex(to.getTime() - 1);
      const currentHour = hourIndex(now());
      const ids = lanes.map((s) => s.id);
      const windows: Timeline['windows'] = [];
      for (let h = firstHour; h <= lastHour; h++) {
        let usage: Map<string, number>;
        if (h >= currentHour - 1) {
          usage = await deps.rateLimiter.senderUsage(ids, h);
        } else {
          const past = await deps.db
            .select({ senderId: emails.senderId, n: sql<number>`count(*)::int` })
            .from(emails)
            .where(
              and(
                eq(emails.status, 'sent'),
                inArray(
                  emails.senderId,
                  ids.length > 0 ? ids : ['00000000-0000-0000-0000-000000000000'],
                ),
                gte(emails.finishedAt, new Date(hourStartMs(h))),
                lt(emails.finishedAt, new Date(hourStartMs(h) + HOUR_MS)),
              ),
            )
            .groupBy(emails.senderId);
          usage = new Map(past.map((p) => [p.senderId, p.n]));
        }
        for (const lane of lanes) {
          windows.push({
            senderId: lane.id,
            hourStart: new Date(hourStartMs(h)).toISOString(),
            used: usage.get(lane.id) ?? 0,
            cap: lane.cap,
          });
        }
      }

      return {
        from: from.toISOString(),
        to: to.toISOString(),
        bucketMs,
        senders: lanes,
        buckets: [...buckets.values()].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0)),
        windows,
      };
    },
  };
}
