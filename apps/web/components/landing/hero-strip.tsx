'use client';

import { HOUR_MS, estimateFinish } from '@cadence/shared';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { cn } from '@/lib/cn';
import { fmtNumber, fmtTime } from '@/lib/format';
import { PaceStrip, type StripPoint, type StripWindow } from '../pace/pace-strip';

// A fixed scenario so the demo looks the same for everyone: three senders with a cap of 12 per
// hour, each planned for 9. Sender B already sent 8 for another campaign, so 5 of its emails
// move into the next hour while A and C stay under the cap.
const START = Date.UTC(2026, 9, 25, 14, 0, 0);
const FROM = START - 6 * 60_000;
const TO = START + 78 * 60_000;
const CAP = 12;
const PRIOR_B = 8;
const TOTAL = 27;
const PLAY_MS = 7000;
const HOLD_MS = 2600;
const LANES = [
  { id: 'a', label: 'Sender A' },
  { id: 'b', label: 'Sender B' },
  { id: 'c', label: 'Sender C' },
];

function useScenario() {
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
    return est.sends;
  }, []);
}

const ease = (x: number) => 1 - (1 - x) ** 3;

/** Phones get the regular strip size so labels and counters fit. */
function useCompact() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return compact;
}

/**
 * Looping progress 0 → 1 that plays, holds, and plays again. Pauses while the board is off
 * screen or the tab is hidden, and stays on the final frame under reduced motion.
 */
function useLoop(ref: RefObject<HTMLElement | null>) {
  const [progress, setProgress] = useState(1);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    let visible = true;
    let elapsed = 0;
    let last = performance.now();
    const cycle = PLAY_MS + HOLD_MS;

    const tick = (now: number) => {
      if (visible && !document.hidden) {
        elapsed = (elapsed + (now - last)) % cycle;
        setProgress(Math.min(1, elapsed / PLAY_MS));
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
    });
    if (ref.current) io.observe(ref.current);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [ref]);
  return progress;
}

function Counter({ label, value, tone }: { label: string; value: string; tone?: 'deferred' }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-label text-ink-3">{label}</dt>
      <dd
        className={cn(
          'mt-1 truncate text-[30px] leading-9 font-semibold tabular [font-stretch:85%] max-sm:text-[22px] max-sm:leading-7',
          tone === 'deferred' ? 'text-deferred' : 'text-ink',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The landing page's live board (design.md §8.1): a real pace strip running a scripted campaign
 * on a loop. Ticks fill in, Sender B reaches its cap, and its remaining emails slide into the
 * next hour.
 */
export function HeroStrip() {
  const sends = useScenario();
  const boardRef = useRef<HTMLDivElement>(null);
  const progress = useLoop(boardRef);
  const compact = useCompact();

  const simNow = FROM + progress * (TO - FROM);
  const slide = 0.12 * (TO - FROM);
  const playing = progress < 1;

  const points: StripPoint[] = sends.map((s) => {
    if (!s.deferred) {
      return {
        lane: s.senderIndex,
        t: s.sendAtMs,
        status: simNow >= s.sendAtMs ? 'sent' : 'scheduled',
        count: 1,
      };
    }
    // Deferred emails wait at their planned time, then slide into the next hour once reached.
    const k = simNow < s.plannedAtMs ? 0 : ease(Math.min(1, (simNow - s.plannedAtMs) / slide));
    return {
      lane: s.senderIndex,
      t: s.plannedAtMs + (s.sendAtMs - s.plannedAtMs) * k,
      status: simNow >= s.sendAtMs ? 'sent' : simNow >= s.plannedAtMs ? 'deferred' : 'scheduled',
      count: 1,
    };
  });

  const startHour = Math.floor(START / HOUR_MS) * HOUR_MS;
  const windows: StripWindow[] = [];
  for (let lane = 0; lane < 3; lane++) {
    for (const h of [startHour, startHour + HOUR_MS]) {
      const sentHere = sends.filter(
        (s) =>
          s.senderIndex === lane &&
          s.sendAtMs >= h &&
          s.sendAtMs < h + HOUR_MS &&
          s.sendAtMs <= simNow,
      ).length;
      const prior = lane === 1 && h === startHour ? PRIOR_B : 0;
      windows.push({ lane, hourStart: h, used: sentHere + prior, cap: CAP });
    }
  }

  const sent = sends.filter((s) => s.sendAtMs <= simNow).length;
  // Counts up as Sender B's overflow is moved, and stays there once those emails go out.
  const moved = sends.filter((s) => s.deferred && s.plannedAtMs <= simNow).length;
  const next = sends
    .filter((s) => s.sendAtMs > simNow)
    .reduce<number | null>((min, s) => (min === null || s.sendAtMs < min ? s.sendAtMs : min), null);

  return (
    <div
      ref={boardRef}
      className="min-w-0 rounded-panel border border-line bg-surface shadow-float"
    >
      <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4 max-sm:px-4">
        <div className="min-w-0">
          <p className="truncate text-section text-ink">Q4 outreach</p>
          <p className="truncate text-label text-ink-3">
            {TOTAL} emails, 3 senders, up to {CAP} per sender each hour
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-signal-soft px-3 py-1.5 text-label text-signal">
          <span
            aria-hidden
            className={cn('size-2 rounded-full bg-signal', playing && 'animate-pulse-slow')}
          />
          {playing ? 'Sending' : 'Finished'}
        </span>
      </div>

      <PaceStrip
        lanes={LANES}
        points={points}
        windows={windows}
        from={FROM}
        to={TO}
        now={playing ? simNow : undefined}
        timeZone="UTC"
        summary="Example: 27 emails across three senders. Sender B reaches its hourly limit, and its remaining emails move to the next hour. Nothing is dropped."
        className="rounded-none border-0 px-6 py-5 max-sm:px-4"
        size={compact ? 'md' : 'lg'}
      />

      <dl className="grid grid-cols-3 gap-4 border-t border-line px-6 py-4 max-sm:px-4" aria-hidden>
        <Counter label="Sent" value={`${fmtNumber(sent)} of ${TOTAL}`} />
        <Counter
          label="Moved to 3 PM"
          value={fmtNumber(moved)}
          tone={moved > 0 ? 'deferred' : undefined}
        />
        <Counter label="Next send" value={next ? fmtTime(next, { timeZone: 'UTC' }) : 'None'} />
      </dl>
    </div>
  );
}
