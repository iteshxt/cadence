import type { AppConfig } from '@cadence/shared';
import { LIMITS } from '@cadence/shared';
import type { Env } from './config/env.js';
import { createDb } from './db/client.js';
import { createCrypto } from './lib/crypto.js';
import { createLogger, type Logger } from './lib/logger.js';
import { createRedis } from './queues/connection.js';
import { createEmailQueue } from './queues/emailQueue.js';
import { createNotifyQueue } from './queues/notifyQueue.js';
import { createEmailsRepo } from './services/emails.repo.js';
import { createRateLimiter } from './services/ratelimit.service.js';
import { createScheduler } from './services/scheduler.service.js';
import { createSearch, createSearchClient } from './services/search.service.js';
import { createGmail } from './services/gmail.service.js';
import { createSendersService } from './services/senders.service.js';
import { createSettingsService } from './services/settings.service.js';
import { createSlack } from './services/slack.service.js';
import { createTimeline } from './services/timeline.service.js';

/** Everything the API and the worker share, built once per process. */
export function createContext(env: Env, log: Logger = createLogger(env.LOG_LEVEL)) {
  const { db, client: sql } = createDb(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL);
  const emailQueue = createEmailQueue(redis);
  const notifyQueue = createNotifyQueue(redis);
  const crypto = createCrypto(env.ENCRYPTION_KEY);
  const search = createSearch(
    createSearchClient(env.ELASTICSEARCH_URL, env.ELASTICSEARCH_API_KEY),
    log,
  );
  const repo = createEmailsRepo(db);
  const rateLimiter = createRateLimiter(redis);
  const cap = env.MAX_EMAILS_PER_HOUR_PER_SENDER;
  const gmail = createGmail({ db, crypto, env, log: log.child({ component: 'gmail' }) });

  const config: AppConfig = {
    workerConcurrency: env.WORKER_CONCURRENCY,
    minSendGapMs: env.MIN_SEND_GAP_MS,
    maxPerHourPerSender: cap,
    maxRecipients: LIMITS.MAX_RECIPIENTS,
    startGraceMs: env.START_GRACE_MS,
  };

  const ctx = {
    env,
    log,
    config,
    db,
    sql,
    redis,
    emailQueue,
    notifyQueue,
    crypto,
    search,
    repo,
    rateLimiter,
    scheduler: createScheduler({ db, env, emailQueue, repo, search, rateLimiter, log }),
    slack: createSlack({ db, crypto, env, log }),
    gmail,
    timeline: createTimeline({ db, rateLimiter, maxPerHourPerSender: cap }),
    senders: createSendersService({ db, rateLimiter, gmail, maxCap: cap }),
    settings: createSettingsService({ db }),

    async close() {
      await ctx.scheduler.settle();
      await Promise.allSettled([emailQueue.close(), notifyQueue.close()]);
      await Promise.allSettled([redis.quit(), sql.end({ timeout: 5 }), search.client.close()]);
    },
  };
  return ctx;
}

export type Context = ReturnType<typeof createContext>;
