import {
  FINISHED_STATUSES,
  PENDING_STATUSES,
  type DeferScope,
  type EmailItem,
  type EmailStatus,
  type EmailView,
  type EmailsPage,
  type Stats,
} from '@cadence/shared';
import { and, asc, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  campaigns,
  emails,
  senders,
  type CampaignRow,
  type EmailRow,
  type SenderRow,
} from '../db/schema.js';
import { decodeCursor, encodeCursor } from '../lib/cursor.js';
import type { EmailDoc } from './search.service.js';

const itemColumns = {
  id: emails.id,
  campaignId: emails.campaignId,
  recipient: emails.recipient,
  subject: campaigns.subject,
  status: emails.status,
  scheduledAt: emails.scheduledAt,
  nextAttemptAt: emails.nextAttemptAt,
  sentAt: emails.sentAt,
  finishedAt: emails.finishedAt,
  senderLabel: senders.label,
  previewUrl: emails.previewUrl,
  error: emails.error,
  deferScope: emails.deferScope,
  deferLimit: emails.deferLimit,
};

interface ItemRow {
  id: string;
  campaignId: string;
  recipient: string;
  subject: string;
  status: EmailStatus;
  scheduledAt: Date;
  nextAttemptAt: Date;
  sentAt: Date | null;
  finishedAt: Date | null;
  senderLabel: string;
  previewUrl: string | null;
  error: string | null;
  deferScope: DeferScope | null;
  deferLimit: number | null;
}

function toItem(r: ItemRow): EmailItem {
  return {
    id: r.id,
    campaignId: r.campaignId,
    recipient: r.recipient,
    subject: r.subject,
    status: r.status,
    scheduledAt: r.scheduledAt.toISOString(),
    nextAttemptAt: r.nextAttemptAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    senderLabel: r.senderLabel,
    previewUrl: r.previewUrl,
    error: r.error,
    deferScope: r.deferScope,
    deferLimit: r.deferLimit,
  };
}

/** Every write bumps `version` and `updated_at` (tech-spec §4) so search writes can be versioned. */
const bump = { version: sql`${emails.version} + 1`, updatedAt: sql`now()` };

export interface SendContext {
  email: EmailRow;
  campaign: Pick<CampaignRow, 'id' | 'userId' | 'subject' | 'body' | 'hourlyLimit' | 'intervalMs'>;
  sender: SenderRow;
}

export function createEmailsRepo(db: Db) {
  async function docs(ids: string[]): Promise<EmailDoc[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .select({
        id: emails.id,
        userId: emails.userId,
        campaignId: emails.campaignId,
        status: emails.status,
        recipient: emails.recipient,
        subject: campaigns.subject,
        body: campaigns.body,
        senderLabel: senders.label,
        scheduledAt: emails.scheduledAt,
        sentAt: emails.sentAt,
        version: emails.version,
      })
      .from(emails)
      .innerJoin(campaigns, eq(campaigns.id, emails.campaignId))
      .innerJoin(senders, eq(senders.id, emails.senderId))
      .where(inArray(emails.id, ids));
    return rows.map((r) => ({
      ...r,
      scheduledAt: r.scheduledAt.toISOString(),
      sentAt: r.sentAt?.toISOString() ?? null,
    }));
  }

  return {
    docs,

    // ---------------------------------------------------------------- reads (API)

    async list(
      userId: string,
      view: EmailView,
      rawCursor: string | undefined,
      limit: number,
    ): Promise<EmailsPage> {
      const cursor = decodeCursor(rawCursor);
      const pending = view === 'scheduled';
      const statusFilter = inArray(
        emails.status,
        pending ? [...PENDING_STATUSES] : [...FINISHED_STATUSES],
      );
      const base = and(eq(emails.userId, userId), statusFilter);
      const sortCol = pending ? emails.nextAttemptAt : emails.finishedAt;
      const after = cursor
        ? pending
          ? sql`(${emails.nextAttemptAt}, ${emails.id}) > (${cursor.t}::timestamptz, ${cursor.id}::uuid)`
          : sql`(${emails.finishedAt}, ${emails.id}) < (${cursor.t}::timestamptz, ${cursor.id}::uuid)`
        : undefined;

      const [rows, [totalRow]] = await Promise.all([
        db
          .select(itemColumns)
          .from(emails)
          .innerJoin(campaigns, eq(campaigns.id, emails.campaignId))
          .innerJoin(senders, eq(senders.id, emails.senderId))
          .where(and(base, after))
          .orderBy(...(pending ? [asc(sortCol), asc(emails.id)] : [desc(sortCol), desc(emails.id)]))
          .limit(limit + 1),
        db.select({ n: count() }).from(emails).where(base),
      ]);

      const page = rows.slice(0, limit).map(toItem);
      const last = page.at(-1);
      const sortValue = last ? (pending ? last.nextAttemptAt : last.finishedAt) : null;
      return {
        items: page,
        nextCursor:
          rows.length > limit && last && sortValue
            ? encodeCursor({ t: sortValue, id: last.id })
            : null,
        total: totalRow?.n ?? 0,
      };
    },

    async getForUser(userId: string, id: string): Promise<EmailItem | null> {
      const [row] = await db
        .select(itemColumns)
        .from(emails)
        .innerJoin(campaigns, eq(campaigns.id, emails.campaignId))
        .innerJoin(senders, eq(senders.id, emails.senderId))
        .where(and(eq(emails.userId, userId), eq(emails.id, id)));
      return row ? toItem(row) : null;
    },

    /** Hydrates search hits from Postgres, preserving the given order and scoping to the user. */
    async getManyForUser(userId: string, ids: string[]): Promise<EmailItem[]> {
      if (ids.length === 0) return [];
      const rows = await db
        .select(itemColumns)
        .from(emails)
        .innerJoin(campaigns, eq(campaigns.id, emails.campaignId))
        .innerJoin(senders, eq(senders.id, emails.senderId))
        .where(and(eq(emails.userId, userId), inArray(emails.id, ids)));
      const byId = new Map(rows.map((r) => [r.id, toItem(r)]));
      return ids.map((id) => byId.get(id)).filter((x): x is EmailItem => Boolean(x));
    },

    async cancel(userId: string, id: string): Promise<EmailRow | null> {
      const [row] = await db
        .update(emails)
        .set({ status: 'cancelled', finishedAt: sql`now()`, ...bump })
        .where(
          and(
            eq(emails.userId, userId),
            eq(emails.id, id),
            inArray(emails.status, ['scheduled', 'deferred']),
          ),
        )
        .returning();
      return row ?? null;
    },

    async stats(userId: string): Promise<Stats> {
      const [r] = await db
        .select({
          scheduled: sql<number>`count(*) filter (where ${emails.status} = 'scheduled')::int`,
          deferred: sql<number>`count(*) filter (where ${emails.status} = 'deferred')::int`,
          sending: sql<number>`count(*) filter (where ${emails.status} = 'sending')::int`,
          sentToday: sql<number>`count(*) filter (where ${emails.status} = 'sent' and ${emails.finishedAt} >= date_trunc('day', now(), 'UTC'))::int`,
          sentLastHour: sql<number>`count(*) filter (where ${emails.status} = 'sent' and ${emails.finishedAt} >= now() - interval '1 hour')::int`,
          sentTotal: sql<number>`count(*) filter (where ${emails.status} in ('sent', 'failed'))::int`,
          failed: sql<number>`count(*) filter (where ${emails.status} = 'failed')::int`,
          nextSendAt: sql<Date | null>`min(${emails.nextAttemptAt}) filter (where ${emails.status} in ('scheduled', 'deferred', 'sending'))`,
          lastPlannedAt: sql<Date | null>`max(${emails.nextAttemptAt}) filter (where ${emails.status} in ('scheduled', 'deferred', 'sending'))`,
        })
        .from(emails)
        .where(eq(emails.userId, userId));
      const toIso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);
      return {
        scheduled: r?.scheduled ?? 0,
        deferred: r?.deferred ?? 0,
        sending: r?.sending ?? 0,
        sentToday: r?.sentToday ?? 0,
        sentLastHour: r?.sentLastHour ?? 0,
        sentTotal: r?.sentTotal ?? 0,
        failed: r?.failed ?? 0,
        nextSendAt: toIso(r?.nextSendAt),
        lastPlannedAt: toIso(r?.lastPlannedAt),
      };
    },

    // ---------------------------------------------------------------- worker

    async loadForSend(emailId: string): Promise<SendContext | null> {
      const [row] = await db
        .select({
          email: emails,
          campaign: {
            id: campaigns.id,
            userId: campaigns.userId,
            subject: campaigns.subject,
            body: campaigns.body,
            hourlyLimit: campaigns.hourlyLimit,
            intervalMs: campaigns.intervalMs,
          },
          sender: senders,
        })
        .from(emails)
        .innerJoin(campaigns, eq(campaigns.id, emails.campaignId))
        .innerJoin(senders, eq(senders.id, emails.senderId))
        .where(eq(emails.id, emailId));
      return row ?? null;
    },

    /** The idempotency guard (§7.2 step 4): only one caller can move a row to `sending`. */
    async claim(emailId: string): Promise<EmailRow | null> {
      const [row] = await db
        .update(emails)
        .set({
          status: 'sending',
          claimedAt: sql`now()`,
          attempts: sql`${emails.attempts} + 1`,
          ...bump,
        })
        .where(and(eq(emails.id, emailId), inArray(emails.status, ['scheduled', 'deferred'])))
        .returning();
      return row ?? null;
    },

    async markSent(emailId: string, messageId: string, previewUrl: string | null): Promise<void> {
      await db
        .update(emails)
        .set({
          status: 'sent',
          sentAt: sql`now()`,
          finishedAt: sql`now()`,
          messageId,
          previewUrl,
          error: null,
          ...bump,
        })
        .where(and(eq(emails.id, emailId), eq(emails.status, 'sending')));
    },

    /** Marks a row failed unless it already reached a final state. */
    async markFailed(emailId: string, error: string): Promise<boolean> {
      const rows = await db
        .update(emails)
        .set({ status: 'failed', finishedAt: sql`now()`, error: error.slice(0, 1000), ...bump })
        .where(
          and(eq(emails.id, emailId), inArray(emails.status, ['scheduled', 'deferred', 'sending'])),
        )
        .returning({ id: emails.id });
      return rows.length > 0;
    },

    async revertToScheduled(emailId: string, error: string): Promise<void> {
      await db
        .update(emails)
        .set({ status: 'scheduled', claimedAt: null, error: error.slice(0, 1000), ...bump })
        .where(and(eq(emails.id, emailId), eq(emails.status, 'sending')));
    },

    async markDeferred(
      emailId: string,
      nextAttemptAt: Date,
      scope: DeferScope,
      limit: number,
    ): Promise<boolean> {
      const rows = await db
        .update(emails)
        .set({ status: 'deferred', nextAttemptAt, deferScope: scope, deferLimit: limit, ...bump })
        .where(and(eq(emails.id, emailId), inArray(emails.status, ['scheduled', 'deferred'])))
        .returning({ id: emails.id });
      return rows.length > 0;
    },

    /** Count for the Slack message (§10 step 4): emails on this sender still due before the next window, plus those already moved into it. */
    async countAffectedByLimit(
      userId: string,
      senderId: string,
      nextWindowStart: Date,
    ): Promise<number> {
      const windowEnd = new Date(nextWindowStart.getTime() + 3_600_000);
      const [r] = await db
        .select({ n: count() })
        .from(emails)
        .where(
          and(
            eq(emails.userId, userId),
            eq(emails.senderId, senderId),
            sql`(
              (${emails.status} = 'scheduled' and ${emails.nextAttemptAt} < ${nextWindowStart.toISOString()}::timestamptz)
              or (${emails.status} = 'deferred' and ${emails.nextAttemptAt} >= ${nextWindowStart.toISOString()}::timestamptz
                  and ${emails.nextAttemptAt} < ${windowEnd.toISOString()}::timestamptz)
            )`,
          ),
        );
      return r?.n ?? 0;
    },

    // ---------------------------------------------------------------- reconciler

    async failExpiredSending(leaseMs: number): Promise<string[]> {
      const rows = await db
        .update(emails)
        .set({ status: 'failed', finishedAt: sql`now()`, error: 'interrupted', ...bump })
        .where(
          and(
            eq(emails.status, 'sending'),
            lt(emails.claimedAt, sql`now() - make_interval(secs => ${leaseMs / 1000})`),
          ),
        )
        .returning({ id: emails.id });
      return rows.map((r) => r.id);
    },

    /** Pending rows in pages, keyed by id, for the reconciler. */
    async pendingPage(afterId: string | null, limit: number) {
      return db
        .select({ id: emails.id, nextAttemptAt: emails.nextAttemptAt })
        .from(emails)
        .where(
          and(
            inArray(emails.status, ['scheduled', 'deferred']),
            afterId ? sql`${emails.id} > ${afterId}::uuid` : undefined,
          ),
        )
        .orderBy(asc(emails.id))
        .limit(limit);
    },
  };
}

export type EmailsRepo = ReturnType<typeof createEmailsRepo>;
