'use client';

import type { EmailStatus } from '@cadence/shared';
import { Check, FileText } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { fmtNumber } from '@/lib/format';
import { StatusMark } from '../emails/status-mark';
import { useInView } from './reveal';

/**
 * Small pieces of the real interface that illustrate each step of a campaign. Each starts a short,
 * quiet piece of motion when it scrolls into view; under reduced motion they show their final state.
 */

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function Frame({
  children,
  frameRef,
}: {
  children: ReactNode;
  frameRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={frameRef}
      aria-hidden
      className="flex h-60 flex-col justify-center gap-4 rounded-panel border border-line bg-surface p-6 transition-[border-color,box-shadow] duration-300 hover:border-control/40 hover:shadow-[0_6px_20px_-12px_rgb(15_18_17/0.25)]"
    >
      {children}
    </div>
  );
}

/** Counts from 0 to `to` with an ease-out curve once `start` is true. */
function useCountUp(to: number, start: boolean, ms = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!start) return;
    if (reducedMotion()) {
      setValue(to);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      setValue(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, start, ms]);
  return value;
}

export function UploadVisual() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const count = useCountUp(1240, inView);
  return (
    <Frame frameRef={ref}>
      <div className="flex h-10 items-center gap-2 rounded-control border border-line px-3">
        <FileText strokeWidth={1.5} className="size-4 text-ink-2" />
        <span className="flex-1 truncate text-body text-ink">q4-leads.csv</span>
        <span className="text-caption text-ink-3">39 KB</span>
      </div>
      <p className="text-body">
        <span className="font-semibold text-ink tabular">{fmtNumber(count)} emails ready</span>
        <span className="text-ink-3">. Removed 12 duplicates and 3 invalid addresses.</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {['Sender A', 'Sender B', 'Sender C'].map((s, i) => (
          <span
            key={s}
            style={{ transitionDelay: inView ? `${500 + i * 120}ms` : undefined }}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-control bg-signal-soft px-2.5 text-caption font-medium text-signal',
              'motion-safe:transition-[opacity,transform] motion-safe:duration-500',
              inView ? 'opacity-100' : 'motion-safe:translate-y-1 motion-safe:opacity-0',
            )}
          >
            <Check strokeWidth={2} className="size-3" /> {s}
          </span>
        ))}
      </div>
    </Frame>
  );
}

function FakeField({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-ink-2">{label}</span>
      <span className="flex h-9 items-center justify-between rounded-control border border-control px-3">
        <span className="tabular text-body text-ink">{value}</span>
        <span className="text-caption text-ink-3">{unit}</span>
      </span>
    </div>
  );
}

export function PaceVisual() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const ticks = 24;
  return (
    <Frame frameRef={ref}>
      <div className="grid grid-cols-2 gap-3">
        <FakeField label="Delay between emails" value="2" unit="seconds" />
        <FakeField label="Hourly limit" value="100" unit="per hour" />
      </div>
      {/* A miniature strip: evenly spaced sends, drawn left to right. */}
      <div className="relative h-4 rounded-[2px] bg-sunken">
        {Array.from({ length: ticks }, (_, i) => (
          <span
            key={i}
            style={{
              left: `${((i + 0.5) / ticks) * 100}%`,
              transitionDelay: inView ? `${200 + i * 45}ms` : undefined,
            }}
            className={cn(
              'absolute top-0.5 bottom-0.5 w-px origin-bottom bg-ink-3',
              'motion-safe:transition-transform motion-safe:duration-300',
              inView ? 'scale-y-100' : 'motion-safe:scale-y-0',
            )}
          />
        ))}
      </div>
      <p className="flex items-baseline justify-between gap-3">
        <span className="text-caption text-ink-3">1 email every 36 seconds</span>
        <span className="text-label text-ink-2">
          Finishes{' '}
          <span className="font-semibold text-ink tabular [font-stretch:85%]">
            Tomorrow, 4:04 AM
          </span>
        </span>
      </p>
    </Frame>
  );
}

const rows = [
  { time: '3:40:12 PM', to: 'jane.doe@acme.com' },
  { time: '3:40:48 PM', to: 'sam@globex.io' },
  { time: '3:41:24 PM', to: 'priya@initech.co' },
];
const STEP_MS = 1400;

export function SendVisual() {
  const [ref, inView] = useInView<HTMLDivElement>();
  // step 0..rows.length*2: each row goes scheduled → sending → sent, one after another, then loops.
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (reducedMotion()) {
      setStep(rows.length * 2);
      return;
    }
    const id = setInterval(() => setStep((s) => (s + 1) % (rows.length * 2 + 3)), STEP_MS);
    return () => clearInterval(id);
  }, [inView]);

  const statusOf = (i: number): EmailStatus => {
    const k = step - i * 2;
    return k <= 0 ? 'scheduled' : k === 1 ? 'sending' : 'sent';
  };

  return (
    <Frame frameRef={ref}>
      <ul className="-my-1 divide-y divide-line">
        {rows.map((r, i) => (
          <li key={r.to} className="flex items-center gap-3 py-1.5">
            <span className="w-20 shrink-0 text-label tabular text-ink [font-stretch:85%]">
              {r.time}
            </span>
            <span className="min-w-0 flex-1 truncate text-label text-ink-2">{r.to}</span>
            <StatusMark status={statusOf(i)} className="shrink-0" />
          </li>
        ))}
        <li className="flex items-center gap-3 py-1.5">
          <span className="w-20 shrink-0 text-label tabular text-ink [font-stretch:85%]">
            4:00:02 PM
          </span>
          <span className="min-w-0 flex-1 truncate text-label text-ink-2">max@example.de</span>
          <StatusMark status="deferred" className="shrink-0" />
        </li>
      </ul>
    </Frame>
  );
}
