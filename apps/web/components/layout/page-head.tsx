import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Dashboard page title with one line of context and optional controls (design.md §8.3). */
export function PageHead({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-end justify-between gap-x-6 gap-y-3 motion-safe:animate-rise',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[36px] leading-[42px] font-semibold tracking-[-0.02em] text-ink max-sm:text-[28px] max-sm:leading-[34px]">
          {title}
        </h1>
        {description && <p className="mt-1.5 text-body-lg text-ink-2">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
