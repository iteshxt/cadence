import { Worker } from 'bullmq';
import type { Context } from './context.js';
import { createNotifyProcessor } from './jobs/notify.processor.js';
import { createSendEmailProcessor } from './jobs/sendEmail.processor.js';
import { createRedis } from './queues/connection.js';
import { EMAIL_QUEUE, type SendJobData } from './queues/emailQueue.js';
import { NOTIFY_QUEUE, type NotifyJobData } from './queues/notifyQueue.js';

/**
 * Starts the email and notification workers on the given context. Used by the worker entry point
 * and, with RUN_WORKER, by the API process itself (tech-spec §13.2).
 */
export function startWorkers(ctx: Context) {
  const { env } = ctx;
  // Workers get their own connections: blocking commands must not share the app connection.
  const emailConnection = createRedis(env.REDIS_URL);
  const notifyConnection = createRedis(env.REDIS_URL);

  const emailWorker = new Worker<SendJobData, void, string>(
    EMAIL_QUEUE,
    createSendEmailProcessor({
      db: ctx.db,
      repo: ctx.repo,
      rateLimiter: ctx.rateLimiter,
      send: ctx.gmail.send,
      notifyQueue: ctx.notifyQueue,
      log: ctx.log.child({ component: 'send' }),
      config: {
        minSendGapMs: env.MIN_SEND_GAP_MS,
        maxPerHourPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        leaseMs: env.SEND_LEASE_MS,
      },
    }),
    {
      connection: emailConnection,
      concurrency: env.WORKER_CONCURRENCY,
      lockDuration: 60_000,
      stalledInterval: 30_000,
      maxStalledCount: 1,
      limiter: { max: env.GLOBAL_LIMITER_MAX, duration: env.GLOBAL_LIMITER_DURATION_MS },
      autorun: false,
    },
  );

  const notifyWorker = new Worker<NotifyJobData, void, string>(
    NOTIFY_QUEUE,
    createNotifyProcessor({
      db: ctx.db,
      repo: ctx.repo,
      slack: ctx.slack,
      rateLimiter: ctx.rateLimiter,
      log: ctx.log.child({ component: 'notify' }),
    }),
    { connection: notifyConnection, concurrency: 2, autorun: false },
  );

  for (const w of [emailWorker, notifyWorker]) {
    w.on('failed', (job, err) =>
      ctx.log.warn({ queue: w.name, jobId: job?.id, err: err.message }, 'job failed'),
    );
    w.on('error', (err) => ctx.log.error({ queue: w.name, err }, 'worker error'));
  }

  void emailWorker.run();
  void notifyWorker.run();
  ctx.log.info(
    {
      concurrency: env.WORKER_CONCURRENCY,
      minGapMs: env.MIN_SEND_GAP_MS,
      maxCapPerHour: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      dryRun: env.SEND_DRY_RUN,
    },
    'worker started',
  );

  return {
    /** Waits for active jobs to finish; delayed jobs stay in Redis (tech-spec §8). */
    async close() {
      await Promise.allSettled([emailWorker.close(), notifyWorker.close()]);
      await Promise.allSettled([emailConnection.quit(), notifyConnection.quit()]);
    },
  };
}
