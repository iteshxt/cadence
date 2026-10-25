import type { DeferScope, EmailStatus } from './constants.js';

/** Every API error uses this body. */
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'DUPLICATE_REQUEST'
  | 'START_IN_PAST'
  | 'NO_SENDERS'
  | 'RATE_LIMITED'
  | 'SLACK_NOT_CONNECTED'
  | 'SLACK_ERROR'
  | 'GMAIL_ERROR'
  | 'SEARCH_UNAVAILABLE'
  | 'CONFLICT'
  | 'INTERNAL';

export interface Me {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface AppConfig {
  workerConcurrency: number;
  minSendGapMs: number;
  maxPerHourPerSender: number;
  maxRecipients: number;
  startGraceMs: number;
}

/** One of the user's connected Gmail accounts (tech-spec §7.3). */
export interface SenderDto {
  id: string;
  label: string;
  fromEmail: string;
  /** The "From" name recipients see; null uses the address alone. */
  displayName: string | null;
  /** This sender's hourly limit. */
  cap: number;
  /** `reconnect`: Google stopped accepting the stored access; the sender can't send. */
  status: 'connected' | 'reconnect';
  /** Sends counted against this sender in the current UTC hour. */
  usedThisHour: number;
  /** ISO start of the next UTC hour, when usage resets. */
  resetsAt: string;
}

export interface UserSettings {
  defaultDelaySeconds: number;
  defaultHourlyLimit: number;
}

export interface CreateCampaignResponse {
  campaignId: string;
  scheduled: number;
  intervalSeconds: number;
  firstAt: string;
  estimatedFinishAt: string;
}

export interface EmailItem {
  id: string;
  campaignId: string;
  recipient: string;
  subject: string;
  status: EmailStatus;
  scheduledAt: string;
  nextAttemptAt: string;
  sentAt: string | null;
  finishedAt: string | null;
  senderLabel: string;
  previewUrl: string | null;
  error: string | null;
  deferScope: DeferScope | null;
  deferLimit: number | null;
}

export interface EmailsPage {
  items: EmailItem[];
  nextCursor: string | null;
  total: number;
}

export interface SearchHit extends EmailItem {
  highlights: { recipient?: string[]; subject?: string[]; body?: string[] };
}

export interface SearchPage {
  items: SearchHit[];
  nextCursor: string | null;
  total: number;
}

export interface Stats {
  scheduled: number;
  deferred: number;
  sending: number;
  sentToday: number;
  sentLastHour: number;
  sentTotal: number;
  failed: number;
  nextSendAt: string | null;
  lastPlannedAt: string | null;
}

export interface TimelineBucket {
  senderId: string;
  t: string;
  scheduled: number;
  sending: number;
  deferred: number;
  sent: number;
  failed: number;
}

export interface TimelineWindow {
  senderId: string;
  hourStart: string;
  used: number;
  cap: number;
}

export interface Timeline {
  from: string;
  to: string;
  bucketMs: number;
  senders: { id: string; label: string; cap: number }[];
  buckets: TimelineBucket[];
  windows: TimelineWindow[];
}

export interface SlackStatus {
  connected: boolean;
  teamName?: string;
  channelName?: string;
}
