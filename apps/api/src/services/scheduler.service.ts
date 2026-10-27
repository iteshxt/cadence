import { randomUUID } from 'node:crypto';
import {
  campaignIntervalMs,
  estimateFinish,
  hourIndex,
  plannedAtMs,
  resolveStart,
  type CreateCampaignBody,
  type CreateCampaignResponse,
} from '@cadence/shared';
import { and, asc, count, eq, inArray, max, min } from 'drizzle-orm';
import type { Env } from '../config/env.js';
import type { Db } from '../db/client.js';
import { campaigns, emails, senders, type CampaignRow } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { sendJobOptions, type EmailQueue } from '../queues/emailQueue.js';
import type { EmailsRepo } from './emails.repo.js';
import type { RateLimiter } from './ratelimit.service.js';
import { senderCap } from './senders.service.js';

const INSERT_CHUNK = 1000;
const ENQUEUE_CHUNK = 500;

export interface SchedulerDeps {
  db: Db;
  env: Pick<Env, 'START_GRACE_MS' | 'MAX_EMAILS_PER_HOUR_PER_SENDER' | 'MIN_SEND_GAP_MS'>;
  emailQueue: EmailQueue;
  repo: EmailsRepo;
  rateLimiter: RateLimiter;
  log: Logger;
  now?: () => number;
}

export type CreateResult =
  | { kind: 'created'; body: CreateCampaignResponse }
  | { kind: 'duplicate'; body: CreateCampaignResponse };

export function createScheduler(deps: SchedulerDeps) {
  const now = deps.now ?? Date.now;

  async function summarize(
    campaign: CampaignRow,
    senderCaps: number[],
  ): Promise<CreateCampaignResponse> {
    const [agg] = await deps.db
      .select({ n: count(), first: min(emails.scheduledAt), last: max(emails.scheduledAt) })
      .from(emails)
      .where(eq(emails.campaignId, campaign.id));
    const est = estimateFinish({
      count: campaign.totalCount,
      startMs: campaign.startAt.getTime(),
      intervalMs: campaign.intervalMs,
      senderCount: senderCaps.length,
      maxPerHourPerSender: deps.env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      senderCaps,
      minSendGapMs: deps.env.MIN_SEND_GAP_MS,
    });
    const first = agg?.first ?? campaign.startAt;
    return {
      campaignId: campaign.id,
      scheduled: agg?.n ?? campaign.totalCount,
      intervalSeconds: campaign.intervalMs / 1000,
      firstAt: first.toISOString(),
      estimatedFinishAt: new Date(est.finishAtMs ?? first.getTime()).toISOString(),
    };
  }

  const capsOf = (rows: { hourlyLimit: number }[]) =>
    rows.map((r) => senderCap(r, deps.env.MAX_EMAILS_PER_HOUR_PER_SENDER));

  /** The user's senders that can send right now: active, and Google still accepts their access. */
  async function activeSenders(userId: string, requested?: string[]) {
    const rows = await deps.db
      .select()
      .from(senders)
      .where(
        and(
          eq(senders.userId, userId),
          eq(senders.isActive, true),
          eq(senders.needsReconnect, false),
          requested ? inArray(senders.id, requested) : undefined,
        ),
      )
      .orderBy(asc(senders.label), asc(senders.id));
    if (requested && rows.length !== new Set(requested).size) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'One or more selected senders are not available',
        {
          fields: { senderIds: 'One or more selected senders are not available' },
        },
      );
    }
    if (rows.length === 0) {
      throw new AppError(
        422,
        'NO_SENDERS',
        'Connect a Gmail account in Settings before scheduling.',
      );
    }
    return rows;
  }

  return {
    async create(
      userId: string,
      input: CreateCampaignBody,
      idempotencyKey?: string,
    ): Promise<CreateResult> {
      if (idempotencyKey) {
        const [existing] = await deps.db
          .select()
          .from(campaigns)
          .where(and(eq(campaigns.userId, userId), eq(campaigns.idempotencyKey, idempotencyKey)));
        if (existing) {
          const caps = capsOf(await activeSenders(userId).catch(() => []));
          return { kind: 'duplicate', body: await summarize(existing, caps) };
        }
      }

      const nowMs = now();
      const start = resolveStart(Date.parse(input.startAt), nowMs, deps.env.START_GRACE_MS);
      if (!start.ok) {
        throw new AppError(
          422,
          'START_IN_PAST',
          'Couldn’t schedule: the start time is more than 5 minutes in the past.',
        );
      }
      const chosen = await activeSenders(userId, input.senderIds);
      const intervalMs = campaignIntervalMs(input.delaySeconds, input.hourlyLimit);
      const recipients = input.recipients;

      const planned = recipients.map((recipient, i) => ({
        id: randomUUID(),
        recipient,
        seq: i,
        sender: chosen[i % chosen.length]!,
        at: new Date(plannedAtMs(start.startMs, i, intervalMs)),
      }));

      const campaign = await deps.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(campaigns)
          .values({
            userId,
            subject: input.subject.trim(),
            body: input.body,
            startAt: new Date(start.startMs),
            delayMs: input.delaySeconds * 1000,
            hourlyLimit: input.hourlyLimit,
            intervalMs,
            totalCount: recipients.length,
            idempotencyKey: idempotencyKey ?? null,
          })
          .onConflictDoNothing({ target: [campaigns.userId, campaigns.idempotencyKey] })
          .returning();
        if (!inserted) return null; // a concurrent request with the same key won the race

        for (let i = 0; i < planned.length; i += INSERT_CHUNK) {
          await tx.insert(emails).values(
            planned.slice(i, i + INSERT_CHUNK).map((p) => ({
              id: p.id,
              campaignId: inserted.id,
              userId,
              senderId: p.sender.id,
              recipient: p.recipient,
              seq: p.seq,
              scheduledAt: p.at,
              nextAttemptAt: p.at,
            })),
          );
        }
        return inserted;
      });

      if (!campaign) {
        const [existing] = await deps.db
          .select()
          .from(campaigns)
          .where(and(eq(campaigns.userId, userId), eq(campaigns.idempotencyKey, idempotencyKey!)));
        return { kind: 'duplicate', body: await summarize(existing!, capsOf(chosen)) };
      }

      // After commit. If the process dies here, the reconciler enqueues these on next boot (§7.1).
      const enqueueAt = Date.now();
      for (let i = 0; i < planned.length; i += ENQUEUE_CHUNK) {
        await deps.emailQueue.addBulk(
          planned.slice(i, i + ENQUEUE_CHUNK).map((p) => ({
            name: 'send' as const,
            data: { emailId: p.id },
            opts: sendJobOptions(p.id, p.at.getTime(), enqueueAt),
          })),
        );
      }

      const usage = await deps.rateLimiter
        .senderUsage(
          chosen.map((s) => s.id),
          hourIndex(start.startMs),
        )
        .catch(() => new Map<string, number>());
      const est = estimateFinish({
        count: recipients.length,
        startMs: start.startMs,
        intervalMs,
        senderCount: chosen.length,
        maxPerHourPerSender: deps.env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        senderCaps: capsOf(chosen),
        minSendGapMs: deps.env.MIN_SEND_GAP_MS,
        existingUsage: chosen.map((s) => ({ [hourIndex(start.startMs)]: usage.get(s.id) ?? 0 })),
      });

      deps.log.info(
        {
          campaignId: campaign.id,
          userId,
          count: recipients.length,
          senders: chosen.length,
          intervalMs,
        },
        'campaign scheduled',
      );

      return {
        kind: 'created',
        body: {
          campaignId: campaign.id,
          scheduled: recipients.length,
          intervalSeconds: intervalMs / 1000,
          firstAt: new Date(est.firstAtMs ?? start.startMs).toISOString(),
          estimatedFinishAt: new Date(est.finishAtMs ?? start.startMs).toISOString(),
        },
      };
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
