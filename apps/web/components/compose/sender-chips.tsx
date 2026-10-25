'use client';

import type { SenderDto } from '@cadence/shared';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fmtNumber } from '@/lib/format';
import { Skeleton } from '../ui/misc';

/** Toggleable 32 px chips; selected ones in --signal-soft with a check (design.md §7.6). */
export function SenderChips({
  senders,
  selected,
  onChange,
  loading,
  error,
}: {
  senders: SenderDto[] | undefined;
  selected: string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  error?: string;
}) {
  if (loading) {
    return (
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>
    );
  }
  if (!senders || senders.length === 0) {
    return (
      <p className="text-body text-ink-2">
        No sender accounts are set up yet. Run the seed script on the server.
      </p>
    );
  }
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-label text-ink">Send from</legend>
      <div className="flex flex-wrap gap-2">
        {senders.map((s) => {
          const on = selected.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              title={s.fromEmail}
              aria-description={s.fromEmail}
              onClick={() => toggle(s.id)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-control border px-3 text-label transition-colors duration-150 max-md:h-11',
                on
                  ? 'border-transparent bg-signal-soft text-signal'
                  : 'border-control bg-surface text-ink-2 hover:text-ink',
              )}
            >
              {on && <Check aria-hidden strokeWidth={2} className="size-3.5" />}
              {s.label}
            </button>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="text-caption text-failed">
          {error}
        </p>
      ) : (
        <p className="text-caption text-ink-3">
          Shared Ethereal test mailboxes, each limited to {fmtNumber(senders[0]!.cap)} emails an
          hour. Mail is captured for preview and never delivered. Hover a sender to see its address.
        </p>
      )}
    </fieldset>
  );
}
