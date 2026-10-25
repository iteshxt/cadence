import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Skeleton } from '../ui/misc';

export interface Readout {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'deferred' | 'failed';
  /** Tooltip-free extra context, shown as a caption. */
  hint?: string;
}

/** Label over a narrow, tabular value; no boxes (design.md §7.2). */
export function Readouts({
  items,
  loading,
  className,
}: {
  items: Readout[];
  loading?: boolean;
  className?: string;
}) {
  return (
    <dl
      className={cn('grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-12', className)}
    >
      {items.map((r) => (
        <div key={r.label} className="min-w-0">
          <dt className="text-label text-ink-2">{r.label}</dt>
          <dd
            className={cn(
              'readout mt-0.5 truncate max-sm:[font-size:1.375rem] max-sm:[line-height:1.75rem]',
              r.tone === 'deferred' && 'text-deferred',
              r.tone === 'failed' && 'text-failed',
            )}
          >
            {loading ? <Skeleton className="mt-1 h-7 w-24" /> : r.value}
          </dd>
          {r.hint && !loading && <dd className="text-caption text-ink-3">{r.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
