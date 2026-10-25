import { z } from 'zod';
import { EMAIL_STATUSES, LIMITS } from './constants.js';
import { isValidEmail, normalizeEmail } from './email.js';

const requiredText = (label: string, max: number) =>
  z
    .string()
    .refine((v) => v.trim().length > 0, { message: `${label} is required` })
    .refine((v) => v.length <= max, {
      message: `${label} must be at most ${max.toLocaleString('en-US')} characters`,
    });

export const RecipientSchema = z
  .string()
  .transform(normalizeEmail)
  .refine(isValidEmail, { message: 'Not a valid email address' });

const DelaySecondsSchema = z
  .number()
  .int()
  .min(LIMITS.DELAY_MIN_SECONDS, 'Delay must be at least 1 second')
  .max(LIMITS.DELAY_MAX_SECONDS, 'Delay must be at most 1 hour');

const HourlyLimitSchema = z
  .number()
  .int()
  .min(LIMITS.HOURLY_MIN, 'Hourly limit must be at least 1')
  .max(
    LIMITS.HOURLY_MAX,
    `Hourly limit must be at most ${LIMITS.HOURLY_MAX.toLocaleString('en-US')}`,
  );

export const CreateCampaignSchema = z.object({
  subject: requiredText('Subject', LIMITS.SUBJECT_MAX),
  body: requiredText('Message', LIMITS.BODY_MAX),
  recipients: z
    .array(RecipientSchema)
    .min(1, 'Add at least one recipient')
    .max(
      LIMITS.MAX_RECIPIENTS,
      `At most ${LIMITS.MAX_RECIPIENTS.toLocaleString('en-US')} recipients per campaign`,
    )
    .transform((list) => [...new Set(list)]),
  startAt: z.iso.datetime({ offset: true, message: 'Start time must be an ISO date-time' }),
  delaySeconds: DelaySecondsSchema,
  hourlyLimit: HourlyLimitSchema,
  senderIds: z.array(z.uuid()).min(1, 'Choose at least one sender').optional(),
});
export type CreateCampaignInput = z.input<typeof CreateCampaignSchema>;
export type CreateCampaignBody = z.output<typeof CreateCampaignSchema>;

/** Client-side form shape: same rules, but recipients come from the parsed file. */
export const ComposeFormSchema = CreateCampaignSchema.omit({
  recipients: true,
  startAt: true,
}).extend({
  startDate: z.string().min(1, 'Choose a start date'),
  startTime: z.string().min(1, 'Choose a start time'),
  sendNow: z.boolean(),
});

const trimmedText = (label: string, max: number) =>
  z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length <= max, {
      message: `${label} must be at most ${max.toLocaleString('en-US')} characters`,
    });

/** PATCH /api/senders/:id. The hourly limit's upper bound is the server maximum, checked by the API. */
export const UpdateSenderSchema = z
  .object({
    label: trimmedText('Label', LIMITS.SENDER_LABEL_MAX)
      .refine((v) => v.length > 0, { message: 'Label is required' })
      .optional(),
    displayName: trimmedText('Display name', LIMITS.SENDER_DISPLAY_NAME_MAX)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    hourlyLimit: z.number().int().min(1, 'Hourly limit must be at least 1').optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Nothing to update',
  });
export type UpdateSenderInput = z.input<typeof UpdateSenderSchema>;

/** PUT /api/settings: the user's Compose defaults, with the campaign fields' bounds. */
export const UserSettingsSchema = z.object({
  defaultDelaySeconds: DelaySecondsSchema,
  defaultHourlyLimit: HourlyLimitSchema,
});

export const EmailViewSchema = z.enum(['scheduled', 'sent']);
export type EmailView = z.infer<typeof EmailViewSchema>;

export const EmailsQuerySchema = z.object({
  view: EmailViewSchema,
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.PAGE_SIZE_MAX).default(LIMITS.PAGE_SIZE),
});

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Enter something to search for').max(LIMITS.SEARCH_QUERY_MAX),
  status: z.enum(EMAIL_STATUSES).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.PAGE_SIZE_MAX).default(LIMITS.PAGE_SIZE),
});

export const TimelineQuerySchema = z
  .object({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  })
  .refine((v) => Date.parse(v.to) > Date.parse(v.from), {
    message: '`to` must be after `from`',
    path: ['to'],
  })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= LIMITS.TIMELINE_MAX_RANGE_MS, {
    message: 'The range can be at most 24 hours',
    path: ['to'],
  });
