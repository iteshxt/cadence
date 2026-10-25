import { Queue } from 'bullmq';
import type { Redis } from './connection.js';

export const NOTIFY_QUEUE = 'notifications';

export interface LimitNotificationData {
  kind: 'sender-limit';
  userId: string;
  senderId: string;
  /** UTC hour index whose cap was reached. */
  hour: number;
  cap: number;
}

export type NotifyJobData = LimitNotificationData;

export function createNotifyQueue(connection: Redis) {
  return new Queue<NotifyJobData, void, string>(NOTIFY_QUEUE, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { age: 86_400, count: 1_000 },
      removeOnFail: { age: 7 * 86_400 },
    },
  });
}

export type NotifyQueue = ReturnType<typeof createNotifyQueue>;
