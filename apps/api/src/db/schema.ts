import { DEFER_SCOPES, EMAIL_STATUSES } from '@cadence/shared';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const emailStatus = pgEnum('email_status', EMAIL_STATUSES);

/** Mirror of the Supabase auth user, upserted by the auth middleware (tech-spec §4). */
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Pre-provisioned Ethereal accounts, shared by all users. */
export const senders = pgTable('senders', {
  id: uuid('id').primaryKey().defaultRandom(),
  label: text('label').notNull(),
  fromEmail: text('from_email').notNull().unique(),
  smtpHost: text('smtp_host').notNull().default('smtp.ethereal.email'),
  smtpPort: integer('smtp_port').notNull().default(587),
  smtpUser: text('smtp_user').notNull(),
  smtpPassEnc: text('smtp_pass_enc').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    startAt: ts('start_at').notNull(),
    delayMs: integer('delay_ms').notNull(),
    hourlyLimit: integer('hourly_limit').notNull(),
    intervalMs: integer('interval_ms').notNull(),
    totalCount: integer('total_count').notNull(),
    idempotencyKey: text('idempotency_key'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [unique('campaigns_user_idempotency_key').on(t.userId, t.idempotencyKey)],
);

export const emails = pgTable(
  'emails',
  {
    /** Also the BullMQ job ID. */
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => senders.id),
    recipient: citext('recipient').notNull(),
    seq: integer('seq').notNull(),
    status: emailStatus('status').notNull().default('scheduled'),
    scheduledAt: ts('scheduled_at').notNull(),
    nextAttemptAt: ts('next_attempt_at').notNull(),
    sentAt: ts('sent_at'),
    finishedAt: ts('finished_at'),
    attempts: integer('attempts').notNull().default(0),
    claimedAt: ts('claimed_at'),
    messageId: text('message_id'),
    previewUrl: text('preview_url'),
    error: text('error'),
    deferScope: text('defer_scope', { enum: DEFER_SCOPES }),
    deferLimit: integer('defer_limit'),
    version: integer('version').notNull().default(1),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('emails_campaign_recipient').on(t.campaignId, t.recipient),
    index('emails_user_status_next').on(t.userId, t.status, t.nextAttemptAt, t.id),
    index('emails_user_finished')
      .on(t.userId, t.finishedAt.desc(), t.id.desc())
      .where(sql`${t.status} in ('sent', 'failed')`),
    index('emails_status_next').on(t.status, t.nextAttemptAt),
    index('emails_sender_finished')
      .on(t.senderId, t.finishedAt)
      .where(sql`${t.status} = 'sent'`),
  ],
);

export const slackConnections = pgTable('slack_connections', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  teamId: text('team_id').notNull(),
  teamName: text('team_name').notNull(),
  channelName: text('channel_name').notNull(),
  webhookUrlEnc: text('webhook_url_enc').notNull(),
  accessTokenEnc: text('access_token_enc').notNull(),
  connectedAt: ts('connected_at').notNull().defaultNow(),
});

/** Audit trail of limit hits (tech-spec §9.3). */
export const rateLimitEvents = pgTable(
  'rate_limit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').notNull(),
    senderId: uuid('sender_id').notNull(),
    campaignId: uuid('campaign_id'),
    windowKey: text('window_key').notNull(),
    scope: text('scope', { enum: DEFER_SCOPES }).notNull(),
    notified: boolean('notified').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('rate_limit_events_user_created').on(t.userId, t.createdAt)],
);

export type EmailRow = typeof emails.$inferSelect;
export type CampaignRow = typeof campaigns.$inferSelect;
export type SenderRow = typeof senders.$inferSelect;
