'use client';

import { HOUR_MS } from '@cadence/shared';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { fmtAxisHour, fmtHourWindow, fmtNumber, fmtTime, plural } from '@/lib/format';

export type StripStatus = 'scheduled' | 'sending' | 'deferred' | 'sent' | 'failed';

export interface StripLane {
  id: string;
  label: string;
}

/** A count of emails at a moment on one lane. One email per point for planned data; bucketed for live data. */
export interface StripPoint {
  lane: number;
  t: number;
  status: StripStatus;
  count: number;
}

/** Cap usage of one lane in one UTC hour window. */
export interface StripWindow {
  lane: number;
  hourStart: number;
  used: number;
  cap: number;
}

export interface PaceStripProps {
  lanes: StripLane[];
  points: StripPoint[];
  windows: StripWindow[];
  from: number;
  to: number;
  /** Draws the now-line. Omitted for planned previews. */
  now?: number;
  /** Text summary for assistive technology (design.md §7.1). */
  summary: string;
  maxLanes?: number;
  timeZone?: string;
  className?: string;
  loading?: boolean;
}

const LANE_H = 28;
const TRACK_TOP = 6;
const TRACK_H = 12;
const USAGE_TOP = 22;
const TOP_PAD = 18; // room for the "Now" caption
const AXIS_H = 22;
const COL = 2; // density column width in px

const STATUS_FILL: Record<StripStatus, string> = {
  sent: 'var(--ink-2)',
  failed: 'var(--failed)',
  sending: 'var(--signal)',
  scheduled: 'var(--ink-3)',
  deferred: 'var(--deferred-mark)',
};
/** Stack order inside a density column, bottom to top. */
const STACK: StripStatus[] = ['sent', 'failed', 'sending', 'scheduled', 'deferred'];

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function PaceStrip({
  lanes,
  points,
  windows,
  from,
  to,
  now,
  summary,
  maxLanes = 4,
  timeZone,
  className,
  loading,
}: PaceStripProps) {
  const [plotRef, width] = useWidth<HTMLDivElement>();
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState<{ lane: number; w: number } | null>(null);
  const tableId = useId();

  const visibleLanes = expanded ? lanes : lanes.slice(0, maxLanes);
  const hidden = lanes.length - visibleLanes.length;
  const span = Math.max(1, to - from);
  const xOf = (t: number) => ((t - from) / span) * width;

  // Hour windows overlapping the range, and the boundaries inside it.
  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = Math.floor(from / HOUR_MS) * HOUR_MS; h < to; h += HOUR_MS) out.push(h);
    return out;
  }, [from, to]);

  // Aggregate points into 2 px columns per lane.
  const columns = useMemo(() => {
    const perLane = visibleLanes.map(() => new Map<number, Record<StripStatus, number>>());
    let max = 0;
    if (width > 0) {
      for (const p of points) {
        if (p.lane >= visibleLanes.length || p.t < from || p.t >= to) continue;
        const col = Math.floor(xOf(p.t) / COL);
        const map = perLane[p.lane]!;
        const c = map.get(col) ?? { sent: 0, failed: 0, sending: 0, scheduled: 0, deferred: 0 };
        c[p.status] += p.count;
        map.set(col, c);
        const total = STACK.reduce((n, s) => n + c[s], 0);
        if (total > max) max = total;
      }
    }
    return { perLane, max };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, width, from, to, visibleLanes.length]);

  const windowFor = useMemo(() => {
    const m = new Map<string, StripWindow>();
    for (const w of windows) m.set(`${w.lane}:${w.hourStart}`, w);
    return (lane: number, hourStart: number) => m.get(`${lane}:${hourStart}`);
  }, [windows]);

  // Deferred emails that landed in each window, for the "moved to" part of the tooltip.
  const deferredIn = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of points) {
      if (p.status !== 'deferred') continue;
      const key = `${p.lane}:${Math.floor(p.t / HOUR_MS) * HOUR_MS}`;
      m.set(key, (m.get(key) ?? 0) + p.count);
    }
    return m;
  }, [points]);

  const cellText = (lane: number, w: number) => {
    const hourStart = hours[w]!;
    const win = windowFor(lane, hourStart);
    const label = visibleLanes[lane]?.label ?? '';
    const range = fmtHourWindow(hourStart, timeZone);
    if (!win) return `${label}, ${range}: no sends.`;
    let text = `${label}, ${range}: ${fmtNumber(win.used)} of ${fmtNumber(win.cap)} used.`;
    const moved = deferredIn.get(`${lane}:${hourStart + HOUR_MS}`) ?? 0;
    if (win.used >= win.cap && moved > 0) {
      text += ` ${plural(moved, 'email')} moved to ${fmtTime(hourStart + HOUR_MS, { timeZone })}.`;
    }
    return text;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Escape'].includes(e.key)
    )
      return;
    e.preventDefault();
    if (e.key === 'Escape') return setActive(null);
    setActive((cur) => {
      const c = cur ?? { lane: 0, w: 0 };
      if (!cur) return c;
      const lanesN = visibleLanes.length;
      const wN = hours.length;
      switch (e.key) {
        case 'ArrowLeft':
          return { ...c, w: Math.max(0, c.w - 1) };
        case 'ArrowRight':
          return { ...c, w: Math.min(wN - 1, c.w + 1) };
        case 'ArrowUp':
          return { ...c, lane: Math.max(0, c.lane - 1) };
        case 'ArrowDown':
          return { ...c, lane: Math.min(lanesN - 1, c.lane + 1) };
        case 'Home':
          return { ...c, w: 0 };
        default:
          return { ...c, w: wN - 1 };
      }
    });
  };

  const plotH = TOP_PAD + visibleLanes.length * LANE_H + AXIS_H;
  const nowX = now !== undefined && now >= from && now <= to ? xOf(now) : null;

  // Axis labels at hour boundaries, thinned so they never collide.
  const labels: { x: number; text: string }[] = [];
  for (const h of hours) {
    if (h <= from) continue;
    const x = xOf(h);
    if (labels.length && x - labels.at(-1)!.x < 56) continue;
    if (x > width - 24) continue;
    labels.push({ x, text: fmtAxisHour(h, timeZone) });
  }

  const activeBox =
    active && hours[active.w] !== undefined
      ? {
          x:
            (Math.max(0, xOf(hours[active.w]!)) +
              Math.min(width, xOf(hours[active.w]! + HOUR_MS))) /
            2,
          y: TOP_PAD + active.lane * LANE_H,
          text: cellText(active.lane, active.w),
        }
      : null;

  return (
    <div className={cn('rounded-panel border border-line bg-surface p-4', className)}>
      <div className="flex">
        {/* Lane labels */}
        <div className="w-16 shrink-0 sm:w-24" style={{ paddingTop: TOP_PAD }} aria-hidden>
          {visibleLanes.map((l) => (
            <div
              key={l.id}
              className="truncate pr-2 text-label text-ink-2"
              style={{ height: LANE_H, lineHeight: `${TRACK_TOP * 2 + TRACK_H}px` }}
            >
              {l.label}
            </div>
          ))}
        </div>

        {/* Plot */}
        <div
          ref={plotRef}
          className="relative min-w-0 flex-1 rounded-control outline-offset-4"
          style={{ height: plotH }}
          tabIndex={0}
          role="group"
          aria-label={`${summary} Use the arrow keys to read each sender's hour windows.`}
          aria-describedby={tableId}
          onKeyDown={onKeyDown}
          onFocus={() =>
            setActive(
              (a) =>
                a ?? {
                  lane: 0,
                  w: Math.max(
                    0,
                    hours.findIndex((h) => now !== undefined && now < h + HOUR_MS),
                  ),
                },
            )
          }
          onBlur={() => setActive(null)}
          onMouseLeave={() => setActive(null)}
          onMouseMove={(e) => {
            if (!width) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const y = e.clientY - rect.top - TOP_PAD;
            const lane = Math.floor(y / LANE_H);
            if (lane < 0 || lane >= visibleLanes.length) return setActive(null);
            const t = from + ((e.clientX - rect.left) / width) * span;
            const w = hours.findIndex((h) => t >= h && t < h + HOUR_MS);
            setActive(w >= 0 ? { lane, w } : null);
          }}
        >
          {width > 0 && (
            <svg
              width={width}
              height={plotH}
              className="absolute inset-0 overflow-visible"
              aria-hidden
            >
              {visibleLanes.map((lane, li) => {
                const y = TOP_PAD + li * LANE_H;
                const cols = columns.perLane[li]!;
                const max = columns.max;
                return (
                  <g key={lane.id}>
                    {/* Full windows get a deferred-soft background behind the lane. */}
                    {hours.map((h) => {
                      const win = windowFor(li, h);
                      if (!win || win.used < win.cap) return null;
                      const x0 = Math.max(0, xOf(h));
                      const x1 = Math.min(width, xOf(h + HOUR_MS));
                      return (
                        <rect
                          key={h}
                          x={x0}
                          y={y + 2}
                          width={x1 - x0}
                          height={LANE_H - 4}
                          fill="var(--deferred-soft)"
                        />
                      );
                    })}
                    <rect
                      x={0}
                      y={y + TRACK_TOP}
                      width={width}
                      height={TRACK_H}
                      rx={2}
                      fill="var(--sunken)"
                    />
                    {[...cols.entries()].map(([col, c]) => {
                      const total = STACK.reduce((n, s) => n + c[s], 0);
                      const x = col * COL;
                      if (total === 1 || max <= 2) {
                        const status = STACK.find((s) => c[s] > 0)!;
                        return (
                          <rect
                            key={col}
                            x={x}
                            y={y + TRACK_TOP}
                            width={total > 1 ? 1.5 : 1}
                            height={TRACK_H}
                            fill={STATUS_FILL[status]}
                            className="transition-[fill] duration-150"
                          />
                        );
                      }
                      // Dense columns: height grows with the count, never below 40% so they stay visible.
                      const h = Math.round(TRACK_H * (0.4 + 0.6 * (total / max)));
                      let base = y + TRACK_TOP + TRACK_H;
                      return (
                        <g key={col}>
                          {STACK.filter((s) => c[s] > 0).map((s) => {
                            const segH = Math.max(1, Math.round((c[s] / total) * h));
                            base -= segH;
                            return (
                              <rect
                                key={s}
                                x={x}
                                y={base}
                                width={1.5}
                                height={segH}
                                fill={STATUS_FILL[s]}
                                className="transition-[fill] duration-150"
                              />
                            );
                          })}
                        </g>
                      );
                    })}
                    {/* Per-window cap usage under the lane, on its own faint track so it reads as a meter. */}
                    <rect x={0} y={y + USAGE_TOP} width={width} height={2} fill="var(--sunken)" />
                    {hours.map((h) => {
                      const win = windowFor(li, h);
                      if (!win || win.used <= 0) return null;
                      const x0 = Math.max(0, xOf(h));
                      const x1 = Math.min(width, xOf(h + HOUR_MS));
                      const ratio = Math.min(1, win.used / win.cap);
                      return (
                        <rect
                          key={h}
                          x={x0}
                          y={y + USAGE_TOP}
                          width={Math.max(1, (x1 - x0) * ratio)}
                          height={2}
                          fill={ratio >= 0.8 ? 'var(--deferred-mark)' : 'var(--ink-3)'}
                        />
                      );
                    })}
                  </g>
                );
              })}

              {/* Hour boundaries (UTC windows). */}
              {hours
                .filter((h) => h > from)
                .map((h) => (
                  <line
                    key={h}
                    x1={xOf(h) + 0.5}
                    x2={xOf(h) + 0.5}
                    y1={TOP_PAD}
                    y2={TOP_PAD + visibleLanes.length * LANE_H + 4}
                    stroke="var(--line)"
                    strokeWidth={1}
                  />
                ))}

              {/* Axis */}
              {labels.map((l) => (
                <text
                  key={l.x}
                  x={l.x}
                  y={plotH - 6}
                  textAnchor="middle"
                  className="fill-ink-3 text-caption [font-stretch:85%] tabular"
                >
                  {l.text}
                </text>
              ))}

              {/* Now line */}
              {nowX !== null && (
                <g
                  className="transition-transform duration-1000 ease-linear"
                  style={{ transform: `translateX(${Math.round(nowX)}px)` }}
                >
                  <line
                    x1={0.5}
                    x2={0.5}
                    y1={TOP_PAD - 4}
                    y2={TOP_PAD + visibleLanes.length * LANE_H}
                    stroke="var(--signal)"
                    strokeWidth={1}
                  />
                  <text x={4} y={TOP_PAD - 7} className="fill-signal text-caption font-medium">
                    Now
                  </text>
                </g>
              )}

              {/* Focus marker for the active cell. */}
              {active && hours[active.w] !== undefined && (
                <rect
                  x={Math.max(0, xOf(hours[active.w]!)) + 0.5}
                  y={TOP_PAD + active.lane * LANE_H + 1.5}
                  width={Math.max(
                    0,
                    Math.min(width, xOf(hours[active.w]! + HOUR_MS)) -
                      Math.max(0, xOf(hours[active.w]!)) -
                      1,
                  )}
                  height={LANE_H - 3}
                  rx={3}
                  fill="none"
                  stroke="var(--signal)"
                  strokeWidth={1}
                />
              )}
            </svg>
          )}

          {loading && width > 0 && (
            <div
              className="absolute inset-0 animate-pulse rounded-control bg-surface/40"
              aria-hidden
            />
          )}

          {activeBox && (
            <div
              role="status"
              className="pointer-events-none absolute z-10 w-max max-w-72 -translate-x-1/2 -translate-y-full rounded-control bg-ink px-2 py-1 text-caption text-canvas"
              style={{
                left: Math.min(Math.max(activeBox.x, 80), Math.max(80, width - 80)),
                top: activeBox.y - 2,
              }}
            >
              {activeBox.text}
            </div>
          )}
        </div>
      </div>

      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 text-label text-signal hover:underline"
        >
          and {plural(hidden, 'more sender')}
        </button>
      )}

      {/* Text equivalent of the strip (design.md §10). */}
      <table id={tableId} className="sr-only">
        <caption>Cap usage per sender and hour</caption>
        <thead>
          <tr>
            <th scope="col">Sender</th>
            <th scope="col">Hour</th>
            <th scope="col">Used</th>
          </tr>
        </thead>
        <tbody>
          {windows
            .filter((w) => w.lane < visibleLanes.length)
            .map((w) => (
              <tr key={`${w.lane}:${w.hourStart}`}>
                <td>{visibleLanes[w.lane]?.label}</td>
                <td>{fmtHourWindow(w.hourStart, timeZone)}</td>
                <td>
                  {w.used} of {w.cap}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
