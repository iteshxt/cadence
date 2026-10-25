import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createCrypto } from '../src/lib/crypto.js';
import { decodeCursor, encodeCursor } from '../src/lib/cursor.js';
import { userFromClaims } from '../src/middleware/auth.js';
import { classifySmtpError } from '../src/services/mailer.service.js';
import { limitMessage } from '../src/services/slack.service.js';
import { pickBucketMs } from '../src/services/timeline.service.js';

describe('crypto', () => {
  const c = createCrypto(randomBytes(32).toString('base64'));

  it('round-trips and uses a fresh IV each time', () => {
    const a = c.encrypt('hooks.slack.com/services/T/B/x');
    const b = c.encrypt('hooks.slack.com/services/T/B/x');
    expect(a).not.toBe(b);
    expect(c.decrypt(a)).toBe('hooks.slack.com/services/T/B/x');
  });

  it('rejects tampered ciphertext', () => {
    const enc = c.encrypt('secret');
    const raw = Buffer.from(enc.slice(3), 'base64');
    raw[raw.length - 1]! ^= 1;
    expect(() => c.decrypt(`v1:${raw.toString('base64')}`)).toThrow();
  });

  it('rejects a key from another deployment', () => {
    const other = createCrypto(randomBytes(32).toString('base64'));
    expect(() => other.decrypt(c.encrypt('secret'))).toThrow();
  });
});

describe('classifySmtpError', () => {
  it.each([
    [{ code: 'ECONNECTION' }, 'retryable'],
    [{ code: 'EDNS' }, 'retryable'],
    [{ code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 454 }, 'retryable'],
    [{ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 451 }, 'retryable'],
    [{ code: 'EENVELOPE', command: 'MAIL FROM' }, 'retryable'],
    [{ code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 535 }, 'permanent'],
    [{ code: 'EENVELOPE', command: 'RCPT TO', responseCode: 550 }, 'permanent'],
    [{ code: 'EMESSAGE', command: 'DATA', responseCode: 451 }, 'ambiguous'],
    [{ code: 'ETIMEDOUT', command: 'DATA' }, 'ambiguous'],
    [{ code: 'ESOCKET' }, 'ambiguous'],
    [{ code: 'ETIMEDOUT' }, 'ambiguous'],
    [new Error('something odd'), 'ambiguous'],
  ])('%j → %s', (err, kind) => {
    expect(classifySmtpError(err)).toBe(kind);
  });
});

describe('userFromClaims', () => {
  it('reads Google profile fields from Supabase metadata', () => {
    expect(
      userFromClaims({
        sub: 'u1',
        email: 'jane@acme.com',
        user_metadata: { full_name: 'Jane Doe', avatar_url: 'https://lh3.googleusercontent.com/a' },
      }),
    ).toEqual({
      id: 'u1',
      email: 'jane@acme.com',
      fullName: 'Jane Doe',
      avatarUrl: 'https://lh3.googleusercontent.com/a',
    });
  });

  it('falls back to name and picture', () => {
    expect(
      userFromClaims({ sub: 'u1', email: 'j@a.co', user_metadata: { name: 'J', picture: 'p' } }),
    ).toMatchObject({
      fullName: 'J',
      avatarUrl: 'p',
    });
  });

  it('rejects tokens without a subject or email', () => {
    expect(userFromClaims({ email: 'j@a.co' })).toBeNull();
    expect(userFromClaims({ sub: 'u1' })).toBeNull();
  });
});

describe('cursor', () => {
  it('round-trips', () => {
    const c = { t: '2026-10-25T10:00:00.000Z', id: '6f1c0f7e-4c49-4bd8-9a5e-6d1a2b3c4d5e' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it('rejects garbage with a 400', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(/Invalid cursor/);
  });
});

describe('limitMessage', () => {
  it('follows the design copy, in UTC', () => {
    const msg = limitMessage('Sender A', 200, 37, new Date('2026-10-25T16:00:00Z'));
    expect(msg.text).toBe(
      '⚠️ Sender A reached its hourly limit (200 of 200). About 37 emails moved to 4:00 PM UTC.',
    );
  });
});

describe('pickBucketMs', () => {
  it('picks 30 s for a 3-hour range and stays under 600 buckets', () => {
    expect(pickBucketMs(3 * 3_600_000)).toBe(30_000);
    expect((24 * 3_600_000) / pickBucketMs(24 * 3_600_000)).toBeLessThanOrEqual(600);
  });
});
