import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Label above, 6 px gap, control, then helper or error caption (design.md §7.6). */
export function Field({
  id,
  label,
  helper,
  error,
  children,
  className,
  required,
}: {
  id: string;
  label: ReactNode;
  helper?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-label text-ink">
        {label}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-caption text-failed" role="alert">
          {error}
        </p>
      ) : helper ? (
        <div id={`${id}-helper`} className="text-caption text-ink-3">
          {helper}
        </div>
      ) : null}
    </div>
  );
}

/** aria props tying a control to its Field caption. */
export function describedBy(id: string, error?: string, helper?: unknown) {
  return {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${id}-error` : helper ? `${id}-helper` : undefined,
  } as const;
}
