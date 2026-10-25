'use client';

import { CircleX, ExternalLink as ExternalIcon } from 'lucide-react';
import { Switch as S } from 'radix-ui';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './button';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('animate-pulse rounded-control bg-sunken [animation-duration:1.5s]', className)}
    />
  );
}

/** Inline error banner inside a panel: failed-soft fill, cross glyph, message, Retry (design.md §7.7). */
export function ErrorBanner({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn('flex items-start gap-3 rounded-control bg-failed-soft px-4 py-3', className)}
    >
      <CircleX aria-hidden strokeWidth={1.5} className="mt-0.5 size-4 shrink-0 text-failed" />
      <p className="flex-1 text-body text-ink">{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Switch({
  id,
  checked,
  onCheckedChange,
  label,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: ReactNode;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <S.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative h-5 w-9 shrink-0 rounded-full bg-control transition-colors duration-150 data-[state=checked]:bg-signal"
      >
        <S.Thumb className="block size-4 translate-x-0.5 rounded-full bg-surface shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-[18px]" />
      </S.Root>
      <label htmlFor={id} className="text-body text-ink">
        {label}
      </label>
    </div>
  );
}

/** Segmented control: --sunken track, selected segment on --surface (design.md §7.6). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex h-8 rounded-control bg-sunken p-0.5', className)}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const dir =
                e.key === 'ArrowRight' || e.key === 'ArrowDown'
                  ? 1
                  : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                    ? -1
                    : 0;
              if (!dir) return;
              e.preventDefault();
              const next = options[(i + dir + options.length) % options.length]!;
              onChange(next.value);
              (
                e.currentTarget.parentElement?.children[
                  (i + dir + options.length) % options.length
                ] as HTMLElement
              )?.focus();
            }}
            className={cn(
              'rounded-[5px] px-3 text-label text-ink-2 transition-colors duration-150',
              selected ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--line)]' : 'hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Link that opens a new tab, marked with the external-link icon (design.md §6). */
export function ExternalLink({
  children,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        'inline-flex items-center gap-1 text-signal underline-offset-4 hover:underline',
        className,
      )}
      {...props}
    >
      {children}
      <ExternalIcon aria-hidden strokeWidth={1.5} className="size-3.5" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-panel border border-line bg-surface', className)}>{children}</div>
  );
}
