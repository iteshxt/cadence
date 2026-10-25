import type { CSSProperties, ReactNode } from 'react';
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
  band,
  style,
  className,
}: {
  items: Readout[];
  loading?: boolean;
  /** A panel of equal columns split by fading dividers, like the landing guarantees band. */
  band?: boolean;
  style?: CSSProperties;
  className?: string;
}) {
  if (band) {
    return (
      <dl
        style={{ '--cols': items.length, ...style } as CSSProperties}
        className={cn(
          'grid grid-cols-2 gap-y-6 rounded-panel border border-line bg-surface px-6 py-5 sm:grid-cols-[repeat(var(--cols),minmax(0,1fr))] max-sm:px-4',
          className,
        )}
      >
        {items.map((r, i) => (
          <div
            key={r.label}
            className={cn(
              'relative min-w-0 before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-linear-to-b before:from-transparent before:via-line before:to-transparent',
              i === 0 ? 'before:hidden' : 'sm:pl-6',
              i % 2 === 1 ? 'max-sm:pl-4' : 'max-sm:before:hidden',
            )}
          >
            <dt className="text-label text-ink-2">{r.label}</dt>
            <dd
              className={cn(
                'readout mt-1 truncate sm:[font-size:1.875rem] sm:[line-height:2.25rem] max-sm:[font-size:1.375rem] max-sm:[line-height:1.75rem]',
                r.tone === 'deferred' && 'text-deferred',
                r.tone === 'failed' && 'text-failed',
              )}
            >
              {loading ? <Skeleton className="mt-1 h-8 w-24" /> : r.value}
            </dd>
            {r.hint && !loading && <dd className="mt-0.5 text-caption text-ink-3">{r.hint}</dd>}
          </div>
        ))}
      </dl>
    );
  }
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
