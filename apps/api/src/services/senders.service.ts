import { hourIndex, hourStartMs, type SenderDto, type UpdateSenderInput } from '@cadence/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { senders, type SenderRow } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import type { Gmail } from './gmail.service.js';
import type { RateLimiter } from './ratelimit.service.js';

export interface SendersDeps {
  db: Db;
  rateLimiter: RateLimiter;
  gmail: Pick<Gmail, 'revoke' | 'forget'>;
  /** The server maximum for any sender's hourly limit. */
  maxCap: number;
  now?: () => number;
}

/** The hourly limit actually enforced: the sender's own, never above the server maximum. */
export function senderCap(sender: Pick<SenderRow, 'hourlyLimit'>, maxCap: number): number {
  return Math.max(1, Math.min(sender.hourlyLimit, maxCap));
}

/** The user's own Gmail senders (PRD §6.10). Every query is scoped by user ID. */
export function createSendersService(deps: SendersDeps) {
  const now = deps.now ?? Date.now;

  async function owned(userId: string, id: string): Promise<SenderRow> {
    const [row] = await deps.db
      .select()
      .from(senders)
      .where(and(eq(senders.id, id), eq(senders.userId, userId), eq(senders.isActive, true)));
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Sender not found');
    return row;
  }

  async function toDtos(rows: SenderRow[]): Promise<SenderDto[]> {
    const hour = hourIndex(now());
    const usage = await deps.rateLimiter.senderUsage(
      rows.map((r) => r.id),
      hour,
    );
    const resetsAt = new Date(hourStartMs(hour + 1)).toISOString();
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      fromEmail: r.fromEmail,
      displayName: r.displayName,
      cap: senderCap(r, deps.maxCap),
      status: r.needsReconnect ? 'reconnect' : 'connected',
      usedThisHour: usage.get(r.id) ?? 0,
      resetsAt,
    }));
  }

  return {
    /** Active senders without secrets, with this UTC hour's usage. */
    async list(userId: string): Promise<SenderDto[]> {
      const rows = await deps.db
        .select()
        .from(senders)
        .where(and(eq(senders.userId, userId), eq(senders.isActive, true)))
        .orderBy(asc(senders.label), asc(senders.id));
      return toDtos(rows);
    },

    async update(userId: string, id: string, input: UpdateSenderInput): Promise<SenderDto> {
      await owned(userId, id);
      if (input.hourlyLimit !== undefined && input.hourlyLimit > deps.maxCap) {
        const message = `Hourly limit must be at most ${deps.maxCap.toLocaleString('en-US')}`;
        throw new AppError(400, 'VALIDATION_ERROR', message, {
          fields: { hourlyLimit: message },
        });
      }
      const [row] = await deps.db
        .update(senders)
        .set({
          ...(input.label !== undefined && { label: input.label }),
          ...(input.displayName !== undefined && { displayName: input.displayName }),
          ...(input.hourlyLimit !== undefined && { hourlyLimit: input.hourlyLimit }),
          updatedAt: new Date(),
        })
        .where(and(eq(senders.id, id), eq(senders.userId, userId)))
        .returning();
      return (await toDtos([row!]))[0]!;
    },

    /**
     * Revokes Google access and deactivates the sender (SET-4). The row stays so past emails keep
     * their history; pending emails fail as "sender disconnected" when they come due.
     */
    async disconnect(userId: string, id: string): Promise<void> {
      const row = await owned(userId, id);
      if (row.refreshTokenEnc) await deps.gmail.revoke(row.refreshTokenEnc);
      await deps.db
        .update(senders)
        .set({ isActive: false, refreshTokenEnc: null, updatedAt: new Date() })
        .where(and(eq(senders.id, id), eq(senders.userId, userId)));
      deps.gmail.forget(id);
    },
  };
}
