export const EMAIL_STATUSES = [
  'scheduled',
  'deferred',
  'sending',
  'sent',
  'failed',
  'cancelled',
] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** Statuses shown in the Scheduled view. */
export const PENDING_STATUSES = [
  'scheduled',
  'deferred',
  'sending',
] as const satisfies readonly EmailStatus[];
/** Statuses shown in the Sent view. */
export const FINISHED_STATUSES = ['sent', 'failed'] as const satisfies readonly EmailStatus[];

export const DEFER_SCOPES = ['sender', 'campaign'] as const;
export type DeferScope = (typeof DEFER_SCOPES)[number];

export const HOUR_MS = 3_600_000;

export const LIMITS = {
  SUBJECT_MAX: 200,
  BODY_MAX: 10_000,
  MAX_RECIPIENTS: 5_000,
  MAX_FILE_BYTES: 2 * 1024 * 1024,
  DELAY_MIN_SECONDS: 1,
  DELAY_MAX_SECONDS: 3_600,
  DELAY_DEFAULT_SECONDS: 2,
  HOURLY_MIN: 1,
  HOURLY_MAX: 3_600,
  HOURLY_DEFAULT: 100,
  /** A new Gmail sender's hourly limit: about 480 a day, under Gmail's ~500 for personal accounts. */
  SENDER_HOURLY_DEFAULT: 20,
  SENDER_LABEL_MAX: 60,
  SENDER_DISPLAY_NAME_MAX: 80,
  PAGE_SIZE: 25,
  PAGE_SIZE_MAX: 100,
  SEARCH_QUERY_MAX: 200,
  TIMELINE_MAX_RANGE_MS: 24 * HOUR_MS,
  TIMELINE_MAX_BUCKETS: 600,
} as const;
