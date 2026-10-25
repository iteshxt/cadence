import { hourStartMs } from '@cadence/shared';
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { senders } from '../db/schema.js';
import type { Logger } from '../lib/logger.js';
import type { NotifyJobData } from '../queues/notifyQueue.js';
import type { EmailsRepo } from '../services/emails.repo.js';
import type { RateLimiter } from '../services/ratelimit.service.js';
import { limitMessage, type Slack } from '../services/slack.service.js';

export interface NotifyProcessorDeps {
  db: Db;
  repo: EmailsRepo;
  slack: Pick<Slack, 'post'>;
  rateLimiter: Pick<RateLimiter, 'releaseNotification'>;
  log: Logger;
}

/**
 * Runs on its own queue so Slack outages never block or fail email sending (SLK-7).
 * Without a connection the job completes silently (SLK-4).
 */
export function createNotifyProcessor(deps: NotifyProcessorDeps) {
  return async function notifyProcessor(job: Job<NotifyJobData>): Promise<void> {
    const { userId, senderId, hour, cap } = job.data;
    const [sender] = await deps.db
      .select({ label: senders.label })
      .from(senders)
      .where(eq(senders.id, senderId));
    const nextWindowStart = new Date(hourStartMs(hour + 1));
    const affected = await deps.repo.countAffectedByLimit(userId, senderId, nextWindowStart);
    const result = await deps.slack.post(
      userId,
      limitMessage(sender?.label ?? 'A sender', cap, affected, nextWindowStart),
    );
    // Nothing was delivered: free this hour's slot so a later limit hit (e.g. after the user
    // reconnects Slack) can alert. The SET NX key still dedupes while Slack is connected.
    if (result !== 'sent') await deps.rateLimiter.releaseNotification(userId, senderId, hour);
    deps.log.info({ userId, senderId, hour, result, affected }, 'limit notification processed');
  };
}
