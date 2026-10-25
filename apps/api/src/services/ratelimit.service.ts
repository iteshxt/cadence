import { readFileSync } from 'node:fs';
import type { DeferScope } from '@cadence/shared';
import type { Result } from 'ioredis';
import type { Redis } from '../queues/connection.js';

const RESERVE_LUA = readFileSync(new URL('../lua/reserve_send.lua', import.meta.url), 'utf8');
const COUNTER_TTL_SEC = 7200;

export type Reservation =
  { kind: 'ok'; slotAt: number } | { kind: 'limit'; scope: DeferScope; hour: number };

export interface ReserveInput {
  nowMs: number;
  senderId: string;
  campaignId: string;
  senderLimit: number;
  campaignLimit: number;
  minGapMs: number;
}

type ReserveReply = ['OK', number] | ['LIMIT', DeferScope, number];

declare module 'ioredis' {
  interface RedisCommander<Context> {
    cadenceReserveSend(gapKey: string, ...args: (string | number)[]): Result<ReserveReply, Context>;
  }
}

export const keys = {
  gap: (senderId: string) => `gap:s:${senderId}`,
  senderHour: (senderId: string, hour: number) => `rl:s:${senderId}:${hour}`,
  campaignHour: (campaignId: string, hour: number) => `rl:c:${campaignId}:${hour}`,
  deferPos: (scope: DeferScope, scopeId: string, hour: number) =>
    `defer:${scope}:${scopeId}:${hour}`,
  notified: (userId: string, senderId: string, hour: number) =>
    `slack:notified:${userId}:${senderId}:${hour}`,
  limitEvent: (scope: DeferScope, scopeId: string, userId: string, hour: number) =>
    `rl:event:${scope}:${scopeId}:${userId}:${hour}`,
};

const defined = new WeakSet<Redis>();

export function createRateLimiter(redis: Redis) {
  if (!defined.has(redis)) {
    redis.defineCommand('cadenceReserveSend', { numberOfKeys: 1, lua: RESERVE_LUA });
    defined.add(redis);
  }

  return {
    async reserve(input: ReserveInput): Promise<Reservation> {
      const reply = await redis.cadenceReserveSend(
        keys.gap(input.senderId),
        input.nowMs,
        input.senderId,
        input.campaignId,
        input.senderLimit,
        input.campaignLimit,
        input.minGapMs,
        COUNTER_TTL_SEC,
      );
      if (reply[0] === 'OK') return { kind: 'ok', slotAt: Number(reply[1]) };
      return { kind: 'limit', scope: reply[1], hour: Number(reply[2]) };
    },

    /** Ordered position of this job among those deferred into `hour` for the scope (§9.3 step 2). */
    async takeDeferPosition(scope: DeferScope, scopeId: string, hour: number): Promise<number> {
      const key = keys.deferPos(scope, scopeId, hour);
      const [[, pos]] = (await redis.multi().incr(key).expire(key, COUNTER_TTL_SEC).exec()) as [
        [Error | null, number],
        unknown,
      ];
      return pos;
    },

    /** True only for the first caller per user, sender, and hour (§9.3 step 7). */
    async claimNotification(userId: string, senderId: string, hour: number): Promise<boolean> {
      return (
        (await redis.set(
          keys.notified(userId, senderId, hour),
          '1',
          'EX',
          COUNTER_TTL_SEC,
          'NX',
        )) === 'OK'
      );
    },

    /**
     * Gives the hour's notification back when it couldn't be delivered (Slack not connected), so
     * the next limit hit after reconnecting alerts again (PRD acceptance 6).
     */
    async releaseNotification(userId: string, senderId: string, hour: number): Promise<void> {
      await redis.del(keys.notified(userId, senderId, hour));
    },

    /** True only the first time a scope's limit is hit for a user in an hour (audit row dedupe). */
    async claimLimitEvent(
      scope: DeferScope,
      scopeId: string,
      userId: string,
      hour: number,
    ): Promise<boolean> {
      return (
        (await redis.set(
          keys.limitEvent(scope, scopeId, userId, hour),
          '1',
          'EX',
          COUNTER_TTL_SEC,
          'NX',
        )) === 'OK'
      );
    },

    /** Sends counted per sender for one hour. Missing counters read as 0. */
    async senderUsage(senderIds: string[], hour: number): Promise<Map<string, number>> {
      const usage = new Map<string, number>();
      if (senderIds.length === 0) return usage;
      const values = await redis.mget(senderIds.map((id) => keys.senderHour(id, hour)));
      senderIds.forEach((id, i) => usage.set(id, Number(values[i] ?? 0)));
      return usage;
    },
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
