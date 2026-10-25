import { expect, it } from 'vitest';
import { cn } from '@/lib/cn';
it('keeps color and custom size together', () => {
  expect(cn('text-ink text-label', 'text-body-lg')).toBe('text-ink text-body-lg');
  expect(cn('bg-signal text-signal-fg', 'h-9 text-body')).toBe(
    'bg-signal text-signal-fg h-9 text-body',
  );
});
