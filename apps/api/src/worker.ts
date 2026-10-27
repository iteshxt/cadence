process.env.CADENCE_SERVICE ??= 'worker';

import { Worker } from 'bullmq';
import { parseEnv } from './config/env.js';
import { createContext } from './context.js';
import { createNotifyProcessor } from './jobs/notify.processor.js';
import { createSendEmailProcessor } from './jobs/sendEmail.processor.js';
import { createRedis } from './queues/connection.js';
import { EMAIL_QUEUE, type SendJobData } from './queues/emailQueue.js';
import { NOTIFY_QUEUE, type NotifyJobData } from './queues/notifyQueue.js';
import { reconcile } from './services/reconciler.service.js';

const env = parseEnv();
const ctx = createContext(env);

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

try {
  await reconcile({
    redis: ctx.redis,
    emailQueue: ctx.emailQueue,
    repo: ctx.repo,
    log: ctx.log.child({ component: 'reconciler' }),
    leaseMs: env.SEND_LEASE_MS,
  });
} catch (err) {
  ctx.log.error({ err }, 'reconciler failed; starting workers anyway');
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

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  ctx.log.info({ signal }, 'draining worker');
  // close() waits for active jobs to finish; delayed jobs stay in Redis (tech-spec §8).
  await Promise.allSettled([emailWorker.close(), notifyWorker.close()]);
  await Promise.allSettled([emailConnection.quit(), notifyConnection.quit()]);
  await ctx.close();
  ctx.log.info('worker stopped');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
