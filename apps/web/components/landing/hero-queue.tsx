'use client';

import { HOUR_MS, estimateFinish, type EmailStatus } from '@cadence/shared';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { cn } from '@/lib/cn';
import { fmtTime } from '@/lib/format';
import { StatusMark } from '../emails/status-mark';

// A fixed scenario so the demo reads the same for everyone: three senders with a cap of 12 per
// hour, one email every 2 minutes 13 seconds. Sender B already sent 8 for another campaign, so 5
// of its emails are moved to 3 PM while A and C stay under the cap.
const START = Date.UTC(2026, 9, 25, 14, 0, 0);
const CAP = 12;
const PRIOR_B = 8;
const TOTAL = 27;
const SENDERS = ['Sender A', 'Sender B', 'Sender C'];
const NAMES = [
  'jane.doe@acme.com',
  'sam@globex.io',
  'priya@initech.co',
  'max@example.de',
  'lena@umbrella.dev',
  'omar@hooli.com',
  'ana@soylent.co',
  'kenji@vandelay.io',
  'zoe@stark.dev',
  'liam@wayne.co',
  'mia@tyrell.ai',
  'noah@cyberdyne.io',
  'emma@massive.co',
  'raj@aperture.dev',
  'ivy@oscorp.io',
  'leo@wonka.co',
  'ada@monarch.dev',
  'tom@paperstreet.co',
  'eva@pied.io',
  'sol@nakatomi.co',
  'kai@buynlarge.io',
  'una@gringotts.co',
  'ben@duff.dev',
  'ria@sterling.co',
  'jay@dunder.io',
  'fay@bluth.co',
  'gus@pollos.dev',
];

const ROW_H = 52;
const VISIBLE = 5;
const STEP_MS = 850;
const HOLD_MS = 2600;

interface Row {
  id: number;
  to: string;
  sender: string;
  plannedAt: number;
  sendAt: number;
  moved: boolean;
}

function useRows(): Row[] {
  return useMemo(() => {
    const est = estimateFinish({
      count: TOTAL,
      startMs: START,
      intervalMs: 133_000,
      senderCount: 3,
      maxPerHourPerSender: CAP,
      minSendGapMs: 90_000,
      existingUsage: [{}, { [Math.floor(START / HOUR_MS)]: PRIOR_B }, {}],
      collect: true,
    });
    return est.sends
      .map((s) => ({
        id: s.index,
        to: NAMES[s.index % NAMES.length]!,
        sender: SENDERS[s.senderIndex]!,
        plannedAt: s.plannedAtMs,
        sendAt: s.sendAtMs,
        moved: s.deferred,
      }))
      .sort((a, b) => a.sendAt - b.sendAt || a.id - b.id);
  }, []);
}

/**
 * Steps through the queue one send at a time, holds at the end, and starts over. Pauses while
 * off screen or in a hidden tab; under reduced motion it rests on a representative moment.
 */
function useStep(ref: RefObject<HTMLElement | null>, count: number) {
  const [step, setStep] = useState(count - 6);
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let visible = true;
    let timer: ReturnType<typeof setTimeout>;
    let current = 0;
    setStep(0);

    const tick = () => {
      if (!visible || document.hidden) {
        timer = setTimeout(tick, 400);
        return;
      }
      if (current >= count) {
        // Jump back to the start without animating the list backwards.
        current = 0;
        setResetting(true);
        setStep(0);
        requestAnimationFrame(() => requestAnimationFrame(() => setResetting(false)));
        timer = setTimeout(tick, STEP_MS * 2);
        return;
      }
      current += 1;
      setStep(current);
      timer = setTimeout(tick, current >= count ? HOLD_MS : STEP_MS);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = Boolean(e?.isIntersecting);
    });
    if (ref.current) io.observe(ref.current);
    timer = setTimeout(tick, 1200);
    return () => {
      clearTimeout(timer);
      io.disconnect();
    };
  }, [ref, count]);
  return { step, resetting };
}

/**
 * The landing page's live demo: a campaign's send queue as a short timetable. Emails roll up as
 * they go out, and when a sender reaches its hourly limit the affected emails are visibly moved
 * to the next hour, with a plain-language note.
 */
export function HeroQueue() {
  const rows = useRows();
  const ref = useRef<HTMLDivElement>(null);
  const { step, resetting } = useStep(ref, rows.length);

  // `step` emails have been sent; the next one is in flight.
  const now = rows[Math.min(step, rows.length - 1)]!.sendAt;
  const sent = Math.min(step, rows.length);
  const done = step >= rows.length;
  const movedSoFar = rows.filter((r) => r.moved && r.plannedAt <= now).length;
  // Moved emails that haven't gone out yet: the amber part of the progress bar.
  const movedWaiting = rows.filter((r, i) => r.moved && r.plannedAt <= now && i >= step).length;
  const limitHit = movedSoFar > 0;

  const statusOf = (r: Row, i: number): EmailStatus => {
    if (i < step) return 'sent';
    if (i === step) return 'sending';
    if (r.moved && r.plannedAt <= now) return 'deferred';
    return 'scheduled';
  };

  // Keep the in-flight row second from the top so recent sends stay visible above it.
  const offset = Math.max(0, Math.min(step - 1, rows.length - VISIBLE));

  return (
    <div
      ref={ref}
      className="min-w-0 overflow-hidden rounded-panel border border-line bg-surface shadow-float"
    >
      <div className="flex items-start justify-between gap-4 px-6 pt-5 max-sm:px-4">
        <div className="min-w-0">
          <p className="truncate text-section text-ink">Q4 outreach</p>
          <p className="text-label text-ink-3 sm:truncate">
            {TOTAL} emails from 3 senders, up to {CAP} per sender each hour
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-control bg-signal-soft px-2.5 py-1 text-label text-signal">
          <span
            aria-hidden
            className={cn('size-2 rounded-full bg-signal', !done && 'animate-pulse-slow')}
          />
          {done ? 'Finished' : 'Sending'}
        </span>
      </div>

      {/* Progress */}
      <div className="px-6 pt-5 pb-4 max-sm:px-4">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[28px] leading-8 font-semibold tabular text-ink [font-stretch:85%]">
            {sent} <span className="text-[18px] text-ink-3">of {TOTAL} sent</span>
          </p>
          <p className="text-label text-ink-3 tabular">
            {done ? 'All sent' : `Next at ${fmtTime(rows[step]!.sendAt, { timeZone: 'UTC' })} UTC`}
          </p>
        </div>
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
          <div
            className="h-full bg-signal transition-[width] duration-500 ease-out"
            style={{ width: `${(sent / TOTAL) * 100}%` }}
          />
          <div
            className="h-full bg-deferred-mark/70 transition-[width] duration-500 ease-out"
            style={{ width: `${(movedWaiting / TOTAL) * 100}%` }}
          />
        </div>
      </div>

      {/* The queue: a short timetable that rolls up as emails go out. */}
      <div
        className="relative overflow-hidden border-t border-line"
        style={{ height: ROW_H * VISIBLE }}
        aria-hidden
      >
        <ul
          className={cn(
            !resetting && 'transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
          )}
          style={{ transform: `translateY(-${offset * ROW_H}px)` }}
        >
          {rows.map((r, i) => {
            const status = statusOf(r, i);
            return (
              <li
                key={r.id}
                style={{ height: ROW_H }}
                className={cn(
                  'flex items-center gap-4 border-b border-line px-6 transition-colors duration-300 max-sm:gap-3 max-sm:px-4',
                  status === 'sending' && 'bg-signal-soft/60',
                  status === 'sent' && 'opacity-60',
                )}
              >
                <span className="w-[88px] shrink-0 max-sm:w-[76px]">
                  <span className="block text-label font-semibold tabular text-ink [font-stretch:85%]">
                    {fmtTime(r.sendAt, { timeZone: 'UTC' })}
                  </span>
                  {r.moved && status !== 'scheduled' && (
                    <span className="block text-caption text-ink-3 tabular">
                      was {fmtTime(r.plannedAt, { timeZone: 'UTC' })}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-body text-ink-2">{r.to}</span>
                <span className="w-[72px] shrink-0 text-label text-ink-3 max-sm:hidden">
                  {r.sender}
                </span>
                <span className="w-[96px] shrink-0 text-right">
                  <StatusMark status={status} />
                </span>
              </li>
            );
          })}
        </ul>
        {/* Soft edges so rows glide in and out of view. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-linear-to-b from-surface to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-surface to-transparent" />
      </div>

      {/* The rate limit, explained in plain words once it happens. */}
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-500 ease-out',
          limitHit ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
        aria-live="polite"
      >
        <div className="overflow-hidden">
          <p className="flex items-start gap-3 border-t border-line bg-deferred-soft px-6 py-4 text-body text-ink max-sm:px-4">
            <StatusMark status="deferred" className="mt-0.5 shrink-0 [&>span:last-child]:sr-only" />
            <span>
              <span className="font-semibold">Sender B reached its limit</span> of {CAP} emails this
              hour. {movedSoFar} {movedSoFar === 1 ? 'email' : 'emails'} moved to 3:00 PM UTC.
              Nothing is dropped.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
