import { cn } from '@/lib/cn';

/** Four evenly spaced ticks on a shared baseline; the fourth, "the next send", in --signal (design.md §2). */
export function Mark({ className, mono = false }: { className?: string; mono?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className={cn('size-5 shrink-0', className)}>
      {[3, 7, 11].map((x) => (
        <rect key={x} x={x} y={4} width={2} height={12} fill="var(--ink)" />
      ))}
      <rect x={15} y={4} width={2} height={12} fill={mono ? 'var(--ink)' : 'var(--signal)'} />
    </svg>
  );
}

export function Logo({ className, size = 'md' }: { className?: string; size?: 'md' | 'lg' }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Mark className={size === 'lg' ? 'size-6' : undefined} />
      <span
        className={cn(
          'leading-none font-semibold tracking-[-0.01em] text-ink',
          size === 'lg' ? 'text-[21px]' : 'text-[17px]',
        )}
      >
        cadence
      </span>
    </span>
  );
}
