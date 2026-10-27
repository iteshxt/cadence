import { randomUUID } from 'node:crypto';
import type { Logger } from '../lib/logger.js';
import type { Redis } from '../queues/connection.js';
import { sendJobOptions, type EmailQueue } from '../queues/emailQueue.js';
import type { EmailsRepo } from './emails.repo.js';

const LOCK_KEY = 'reconcile:lock';
const LOCK_TTL_SEC = 60;
const PAGE = 1000;

export interface ReconcileSummary {
  requeued: number;
  replaced: number;
  interrupted: number;
  skipped?: 'locked';
}

export interface ReconcilerDeps {
  redis: Redis;
  emailQueue: EmailQueue;
  repo: EmailsRepo;
  log: Logger;
  leaseMs: number;
}

/**
 * Boot-time repair (tech-spec §8). Runs once when the API or the worker starts, never on a timer.
 * Safe to run any number of times: the database claim still prevents double sends.
 */
export async function reconcile(deps: ReconcilerDeps): Promise<ReconcileSummary> {
  const token = randomUUID();
  const locked = await deps.redis.set(LOCK_KEY, token, 'EX', LOCK_TTL_SEC, 'NX');
  if (locked !== 'OK') {
    deps.log.info('reconciler already running elsewhere; skipping');
    return { requeued: 0, replaced: 0, interrupted: 0, skipped: 'locked' };
  }

  const summary: ReconcileSummary = { requeued: 0, replaced: 0, interrupted: 0 };
  try {
    // 1. Claims whose lease expired: the send may or may not have happened, so never resend.
    const interrupted = await deps.repo.failExpiredSending(deps.leaseMs);
    summary.interrupted = interrupted.length;

    // 2. Pending rows without a live job.
    let afterId: string | null = null;
    for (;;) {
      const rows = await deps.repo.pendingPage(afterId, PAGE);
      if (rows.length === 0) break;
      afterId = rows.at(-1)!.id;
      await deps.redis.expire(LOCK_KEY, LOCK_TTL_SEC);

      const missing: typeof rows = [];
      for (const row of rows) {
        const job = await deps.emailQueue.getJob(row.id);
        if (!job) {
          missing.push(row);
          continue;
        }
        const state = await job.getState();
        if (state === 'completed' || state === 'failed') {
          // A stale leftover kept by removeOnComplete/removeOnFail would make BullMQ ignore
          // the re-add (job IDs are deduplicated), so remove it first.
          await job.remove();
          missing.push(row);
          summary.replaced++;
        }
      }

      if (missing.length > 0) {
        const now = Date.now();
        await deps.emailQueue.addBulk(
          missing.map((r) => ({
            name: 'send' as const,
            data: { emailId: r.id },
            opts: sendJobOptions(r.id, r.nextAttemptAt.getTime(), now),
          })),
        );
        summary.requeued += missing.length;
      }
      if (rows.length < PAGE) break;
    }
  } finally {
    // Release only our own lock.
    await deps.redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      1,
      LOCK_KEY,
      token,
    );
  }

  deps.log.info(summary, 'reconciler finished');
  return summary;
}
