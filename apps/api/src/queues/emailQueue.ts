import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from './connection.js';

export const EMAIL_QUEUE = 'email-send';

export interface SendJobData {
  emailId: string;
  /** Set once the job has reserved a send slot and is sleeping until it (tech-spec §7.2 step 3). */
  slotAt?: number;
}

export const SEND_ATTEMPTS = 3;

export function sendJobOptions(emailId: string, runAtMs: number, nowMs = Date.now()): JobsOptions {
  return {
    jobId: emailId,
    delay: Math.max(0, runAtMs - nowMs),
    attempts: SEND_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86_400, count: 10_000 },
    removeOnFail: { age: 7 * 86_400 },
  };
}

export function createEmailQueue(connection: Redis) {
  return new Queue<SendJobData, void, 'send'>(EMAIL_QUEUE, { connection });
}

export type EmailQueue = ReturnType<typeof createEmailQueue>;
