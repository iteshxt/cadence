import { describe, expect, it } from 'vitest';
import {
  CreateCampaignSchema,
  TimelineQuerySchema,
  UpdateSenderSchema,
  UserSettingsSchema,
} from '../src/schemas.js';
import { isValidEmail, normalizeEmail } from '../src/email.js';

const valid = {
  subject: 'Quick question',
  body: 'Hi there',
  recipients: ['A@Example.com', 'a@example.com', 'b@example.org'],
  startAt: '2026-10-25T09:30:00.000Z',
  delaySeconds: 2,
  hourlyLimit: 100,
};

describe('email helpers', () => {
  it('normalizes case, whitespace, and mailto prefixes', () => {
    expect(normalizeEmail('  MAILTO:Jane.Doe@Acme.COM ')).toBe('jane.doe@acme.com');
  });
  it.each(['jane@acme.com', 'j.d+tag@sub.acme.co.uk', "o'neil@acme.io"])('accepts %s', (e) => {
    expect(isValidEmail(e)).toBe(true);
  });
  it.each(['jane@acme', 'jane acme.com', '@acme.com', 'jane@.com', 'jane@acme.c', ''])(
    'rejects %s',
    (e) => {
      expect(isValidEmail(e)).toBe(false);
    },
  );
});

describe('CreateCampaignSchema', () => {
  it('normalizes and dedupes recipients', () => {
    const parsed = CreateCampaignSchema.parse(valid);
    expect(parsed.recipients).toEqual(['a@example.com', 'b@example.org']);
  });
  it('rejects a blank subject with a readable message', () => {
    const r = CreateCampaignSchema.safeParse({ ...valid, subject: '   ' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('Subject is required');
  });
  it('rejects invalid recipients', () => {
    const r = CreateCampaignSchema.safeParse({ ...valid, recipients: ['nope'] });
    expect(r.success).toBe(false);
  });
  it('enforces the pacing bounds', () => {
    expect(CreateCampaignSchema.safeParse({ ...valid, delaySeconds: 0 }).success).toBe(false);
    expect(CreateCampaignSchema.safeParse({ ...valid, hourlyLimit: 3601 }).success).toBe(false);
    expect(CreateCampaignSchema.safeParse({ ...valid, hourlyLimit: 3600 }).success).toBe(true);
  });
  it('rejects more than 5,000 recipients', () => {
    const many = Array.from({ length: 5001 }, (_, i) => `u${i}@example.com`);
    expect(CreateCampaignSchema.safeParse({ ...valid, recipients: many }).success).toBe(false);
  });
});

describe('TimelineQuerySchema', () => {
  it('accepts up to 24 hours', () => {
    expect(
      TimelineQuerySchema.safeParse({ from: '2026-10-25T00:00:00Z', to: '2026-10-26T00:00:00Z' })
        .success,
    ).toBe(true);
  });
  it('rejects longer or inverted ranges', () => {
    expect(
      TimelineQuerySchema.safeParse({ from: '2026-10-25T00:00:00Z', to: '2026-10-26T00:00:01Z' })
        .success,
    ).toBe(false);
    expect(
      TimelineQuerySchema.safeParse({ from: '2026-10-25T01:00:00Z', to: '2026-10-25T00:00:00Z' })
        .success,
    ).toBe(false);
  });
});

describe('UpdateSenderSchema', () => {
  it('trims text and turns an empty display name into null', () => {
    expect(UpdateSenderSchema.parse({ label: '  Sales  ', displayName: '  ' })).toEqual({
      label: 'Sales',
      displayName: null,
    });
  });
  it('rejects an empty label, a zero limit, and an empty update', () => {
    expect(UpdateSenderSchema.safeParse({ label: '   ' }).success).toBe(false);
    expect(UpdateSenderSchema.safeParse({ hourlyLimit: 0 }).success).toBe(false);
    expect(UpdateSenderSchema.safeParse({}).success).toBe(false);
  });
});

describe('UserSettingsSchema', () => {
  it("uses the campaign fields' bounds", () => {
    expect(
      UserSettingsSchema.safeParse({ defaultDelaySeconds: 2, defaultHourlyLimit: 100 }).success,
    ).toBe(true);
    expect(
      UserSettingsSchema.safeParse({ defaultDelaySeconds: 0, defaultHourlyLimit: 100 }).success,
    ).toBe(false);
    expect(
      UserSettingsSchema.safeParse({ defaultDelaySeconds: 2, defaultHourlyLimit: 3601 }).success,
    ).toBe(false);
  });
});
