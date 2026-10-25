import { Redis, type RedisOptions } from 'ioredis';

/**
 * BullMQ needs `maxRetriesPerRequest: null` on connections used by workers (blocking calls)
 * and recommends it everywhere; queues and app code share the same setting for simplicity.
 */
export function createRedis(url: string, extra: RedisOptions = {}): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, ...extra });
}

export type { Redis };
