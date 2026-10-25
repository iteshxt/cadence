import { describe, expect, it } from 'vitest';
import {
  fmtDayTime,
  fmtDuration,
  fmtHourWindow,
  fmtInterval,
  fmtRelative,
  tzLabel,
} from './format';

const at = (iso: string) => Date.parse(iso);

describe('format', () => {
  it('labels hour windows in the user timezone', () => {
    expect(fmtHourWindow('2026-10-25T15:00:00Z', 'UTC')).toBe('3 PM to 4 PM');
    // Half-hour zones show minutes, because UTC windows start at :30 there.
    expect(fmtHourWindow('2026-10-25T10:00:00Z', 'Asia/Kolkata')).toBe('3:30 PM to 4:30 PM');
  });

  it('writes relative times without trailing periods', () => {
    const now = at('2026-10-25T10:00:00Z');
    expect(fmtRelative(now + 12 * 60_000, now)).toBe('in 12 min');
    expect(fmtRelative(now - 2 * 3_600_000, now)).toBe('2 h ago');
    expect(fmtRelative(now + 10_000, now)).toBe('in a few seconds');
  });

  it('prefixes today and tomorrow', () => {
    const now = at('2026-10-25T10:00:00Z');
    expect(fmtDayTime(at('2026-10-25T18:42:00Z'), now, 'UTC')).toBe('Today, 6:42 PM');
    expect(fmtDayTime(at('2026-10-26T04:04:00Z'), now, 'UTC')).toBe('Tomorrow, 4:04 AM');
    expect(fmtDayTime(at('2026-10-28T09:00:00Z'), now, 'UTC')).toBe('Oct 28, 9:00 AM');
  });

  it('formats durations and intervals', () => {
    expect(fmtDuration(36_000)).toBe('36 s');
    expect(fmtDuration(4 * 3_600_000 + 8 * 60_000)).toBe('4 h 8 min');
    expect(fmtInterval(36_000)).toBe('1 email every 36 seconds');
    expect(fmtInterval(1_000)).toBe('1 email every 1 second');
    expect(fmtInterval(120_000)).toBe('1 email every 2 minutes');
  });

  it('shows the zone with its offset', () => {
    expect(tzLabel(at('2026-10-25T10:00:00Z'), 'Asia/Kolkata')).toBe('Asia/Kolkata, UTC+05:30');
    expect(tzLabel(at('2026-10-25T10:00:00Z'), 'UTC')).toBe('UTC, UTC+00:00');
  });
});
