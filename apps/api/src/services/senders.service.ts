import { hourIndex, hourStartMs, type SenderDto } from '@cadence/shared';
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { senders } from '../db/schema.js';
import type { RateLimiter } from './ratelimit.service.js';

export function createSendersService(deps: {
  db: Db;
  rateLimiter: RateLimiter;
  cap: number;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  return {
    /** Active senders without secrets, with this UTC hour's usage (shared by all users). */
    async list(): Promise<SenderDto[]> {
      const rows = await deps.db
        .select({ id: senders.id, label: senders.label, fromEmail: senders.fromEmail })
        .from(senders)
        .where(eq(senders.isActive, true))
        .orderBy(asc(senders.label), asc(senders.id));
      const hour = hourIndex(now());
      const usage = await deps.rateLimiter.senderUsage(
        rows.map((r) => r.id),
        hour,
      );
      const resetsAt = new Date(hourStartMs(hour + 1)).toISOString();
      return rows.map((r) => ({
        ...r,
        usedThisHour: usage.get(r.id) ?? 0,
        cap: deps.cap,
        resetsAt,
      }));
    },
  };
}
