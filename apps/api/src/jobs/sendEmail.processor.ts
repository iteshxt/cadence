import { deferTargetMs, type DeferScope } from '@cadence/shared';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import type { Db } from '../db/client.js';
import { rateLimitEvents } from '../db/schema.js';
import type { Logger } from '../lib/logger.js';
import type { SendJobData } from '../queues/emailQueue.js';
import type { NotifyQueue } from '../queues/notifyQueue.js';
import type { EmailsRepo, SendContext } from '../services/emails.repo.js';
import { classifySendError, type SendFn } from '../services/gmail.service.js';
import type { RateLimiter } from '../services/ratelimit.service.js';
import { senderCap } from '../services/senders.service.js';

/** A reserved slot this close to now counts as "now" (§7.2 step 3). */
const SLOT_TOLERANCE_MS = 50;
/** BullMQ may promote a delayed job a hair early; don't bounce it for that. */
const ELIGIBLE_TOLERANCE_MS = 250;

export interface SendProcessorDeps {
  db: Db;
  repo: EmailsRepo;
  rateLimiter: RateLimiter;
  send: SendFn;
  notifyQueue: Pick<NotifyQueue, 'add'>;
  log: Logger;
  config: {
    minSendGapMs: number;
    /** The server maximum; each sender's own limit is clamped to it. */
    maxPerHourPerSender: number;
    leaseMs: number;
  };
  now?: () => number;
}

type SendJob = Job<SendJobData, void, string>;

function isFinalAttempt(job: SendJob): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createSendEmailProcessor(deps: SendProcessorDeps) {
  const now = deps.now ?? Date.now;

  async function sleepUntil(
    job: SendJob,
    token: string | undefined,
    at: number,
    data: SendJobData,
  ): Promise<never> {
    await job.updateData(data);
    await job.moveToDelayed(Math.ceil(at), token);
    throw new DelayedError();
  }

  async function defer(
    job: SendJob,
    token: string | undefined,
    ctx: SendContext,
    scope: DeferScope,
    hour: number,
  ): Promise<never> {
    const { email, campaign, sender } = ctx;
    const isSender = scope === 'sender';
    const scopeId = isSender ? sender.id : campaign.id;
    const cap = isSender
      ? senderCap(sender, deps.config.maxPerHourPerSender)
      : campaign.hourlyLimit;
    const spacing = isSender ? deps.config.minSendGapMs : campaign.intervalMs;
    const pos = await deps.rateLimiter.takeDeferPosition(scope, scopeId, hour + 1);
    const at = deferTargetMs(hour + 1, pos, cap, spacing);

    await deps.repo.markDeferred(email.id, new Date(at), scope, cap);

    if (await deps.rateLimiter.claimLimitEvent(scope, scopeId, campaign.userId, hour)) {
      let notified = false;
      if (
        isSender &&
        (await deps.rateLimiter.claimNotification(campaign.userId, sender.id, hour))
      ) {
        await deps.notifyQueue.add('sender-limit', {
          kind: 'sender-limit',
          userId: campaign.userId,
          senderId: sender.id,
          hour,
          cap,
        });
        notified = true;
      }
      await deps.db.insert(rateLimitEvents).values({
        userId: campaign.userId,
        senderId: sender.id,
        campaignId: campaign.id,
        windowKey: String(hour),
        scope,
        notified,
      });
    }

    deps.log.info(
      { emailId: email.id, scope, hour, deferredTo: new Date(at).toISOString(), pos },
      'email deferred',
    );
    return sleepUntil(job, token, at, { emailId: email.id });
  }

  async function process(job: SendJob, token?: string): Promise<void> {
    const { emailId } = job.data;
    const log = deps.log.child({ emailId, jobId: job.id, attempt: job.attemptsMade + 1 });

    const ctx = await deps.repo.loadForSend(emailId);
    if (!ctx) {
      log.warn('email no longer exists; dropping job');
      return;
    }
    const { email, campaign, sender } = ctx;

    // Step 1: idempotency and interrupted-claim handling.
    if (email.status === 'sent' || email.status === 'failed' || email.status === 'cancelled')
      return;
    if (email.status === 'sending') {
      const leaseEnd = (email.claimedAt?.getTime() ?? 0) + deps.config.leaseMs;
      if (now() >= leaseEnd) {
        if (await deps.repo.markFailed(emailId, 'interrupted')) {
          log.warn(
            'previous attempt was interrupted after its claim; marked failed instead of resending',
          );
        }
        return;
      }
      // The lease hasn't run out: check again when it does, never leave the row stuck (§7.2).
      return sleepUntil(job, token, leaseEnd, { emailId });
    }

    // A disconnected sender's emails fail rather than move to another account (PRD SCD-7).
    if (!sender.isActive || sender.needsReconnect || sender.userId !== campaign.userId) {
      if (await deps.repo.markFailed(emailId, 'sender disconnected')) {
        log.warn({ senderId: sender.id }, 'sender is disconnected; email marked failed');
      }
      return;
    }

    // Step 2: not yet eligible.
    const nextAttempt = email.nextAttemptAt.getTime();
    if (now() + ELIGIBLE_TOLERANCE_MS < nextAttempt) {
      return sleepUntil(job, token, nextAttempt, { emailId });
    }

    // Step 3: reserve a send slot, unless this job is waking up for one it already holds.
    if (job.data.slotAt == null) {
      const r = await deps.rateLimiter.reserve({
        nowMs: now(),
        senderId: sender.id,
        campaignId: campaign.id,
        senderLimit: senderCap(sender, deps.config.maxPerHourPerSender),
        campaignLimit: campaign.hourlyLimit,
        minGapMs: deps.config.minSendGapMs,
      });
      if (r.kind === 'limit') return defer(job, token, ctx, r.scope, r.hour);
      if (r.slotAt > now() + SLOT_TOLERANCE_MS) {
        return sleepUntil(job, token, r.slotAt, { emailId, slotAt: r.slotAt });
      }
    }

    // Step 4: claim. If someone else already has it, we're done.
    const claimed = await deps.repo.claim(emailId);
    if (!claimed) {
      log.info('already claimed elsewhere; skipping');
      return;
    }
    if (job.data.slotAt != null) await job.updateData({ emailId });

    // Steps 5–7: send and record the outcome.
    try {
      const result = await deps.send(sender, {
        emailId,
        to: email.recipient,
        subject: campaign.subject,
        text: campaign.body,
      });
      await deps.repo.markSent(emailId, result.messageId, result.previewUrl);
      log.info({ senderId: sender.id, campaignId: campaign.id }, 'email sent');
    } catch (err) {
      const kind = classifySendError(err);
      const message = messageOf(err);
      if (kind === 'retryable' && !isFinalAttempt(job)) {
        await deps.repo.revertToScheduled(emailId, message);
        log.warn({ err: message }, 'retryable send error; will retry');
        throw err;
      }
      const reason = kind === 'ambiguous' ? `ambiguous: ${message}` : message;
      await deps.repo.markFailed(emailId, reason);
      log.error({ err: message, kind }, 'email failed');
      throw new UnrecoverableError(reason);
    }
  }

  /** Step 8: any other error. On the final attempt, never leave the row pending behind a failed job. */
  return async function sendEmailProcessor(job: SendJob, token?: string): Promise<void> {
    try {
      await process(job, token);
    } catch (err) {
      if (err instanceof DelayedError || err instanceof UnrecoverableError) throw err;
      // Send errors never reach here on the final attempt (they are settled above as
      // UnrecoverableError), so this only handles database, Redis, or unexpected errors.
      if (isFinalAttempt(job)) {
        try {
          await deps.repo.markFailed(job.data.emailId, `error: ${messageOf(err)}`);
        } catch (markErr) {
          deps.log.error(
            { err: messageOf(markErr), emailId: job.data.emailId },
            'could not mark email failed; reconciler will repair it',
          );
        }
      }
      throw err;
    }
  };
}
