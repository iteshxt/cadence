'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/cn';

/** True once the element has scrolled into view (and stays true). */
export function useInView<T extends Element>(
  margin = '0px 0px -12% 0px',
): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin, inView]);
  return [ref, inView];
}

/**
 * Fades and lifts its content once, the first time it scrolls into view. The hidden starting
 * state only applies with motion allowed, so reduced-motion users always see content as-is.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      style={{ transitionDelay: inView ? `${delay}ms` : undefined }}
      className={cn(
        'motion-safe:transition-[opacity,transform] motion-safe:duration-700 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]',
        inView ? 'opacity-100' : 'motion-safe:translate-y-4 motion-safe:opacity-0',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The brand mark at display size: four evenly spaced ticks drawn in one after another when they
 * scroll into view, the last ("the next send") in --signal.
 */
export function TicksMark({ className, onAccent }: { className?: string; onAccent?: boolean }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} aria-hidden className={cn('flex h-16 items-end gap-3.5', className)}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          style={{ transitionDelay: inView ? `${i * 140}ms` : undefined }}
          className={cn(
            'h-full w-2 origin-bottom',
            onAccent
              ? i === 3
                ? 'bg-signal-fg'
                : 'bg-signal-fg/45'
              : i === 3
                ? 'bg-signal'
                : 'bg-ink',
            'motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]',
            inView ? 'scale-y-100' : 'motion-safe:scale-y-0',
          )}
        />
      ))}
    </div>
  );
}
