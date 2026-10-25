'use client';

import type { Timeline } from '@cadence/shared';
import { useEffect, useMemo, useState } from 'react';
import { useTimeline } from '@/hooks/queries';
import { fmtDayTime, fmtNumber, plural } from '@/lib/format';
import { ErrorBanner } from '../ui/misc';
import { PaceStrip, type StripPoint, type StripStatus, type StripWindow } from './pace-strip';

export type StripRange = '3h' | '12h' | '24h';
const RANGE_MS: Record<StripRange, number> = {
  '3h': 3 * 3_600_000,
  '12h': 12 * 3_600_000,
  '24h': 24 * 3_600_000,
};
const STATUSES: StripStatus[] = ['scheduled', 'sending', 'deferred', 'sent', 'failed'];

/**
 * Ticks once a second so the now-line moves; the query key only changes once a minute.
 * Starts at 0 and is set after mount, so server and client render the same markup
 * (the server has neither the user's clock nor their timezone).
 */
function useNow(stepMs = 1000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

export function toStripData(tl: Timeline) {
  const laneIndex = new Map(tl.senders.map((s, i) => [s.id, i]));
  const points: StripPoint[] = [];
  for (const b of tl.buckets) {
    const lane = laneIndex.get(b.senderId);
    if (lane === undefined) continue;
    const t = Date.parse(b.t) + tl.bucketMs / 2;
    for (const status of STATUSES)
      if (b[status] > 0) points.push({ lane, t, status, count: b[status] });
  }
  const windows: StripWindow[] = tl.windows.flatMap((w) => {
    const lane = laneIndex.get(w.senderId);
    return lane === undefined
      ? []
      : [{ lane, hourStart: Date.parse(w.hourStart), used: w.used, cap: w.cap }];
  });
  return { lanes: tl.senders.map((s) => ({ id: s.id, label: s.label })), points, windows };
}

/**
 * Dashboard pace strip. `mode="upcoming"` starts 15 minutes ago (Scheduled page);
 * `mode="recent"` shows the last few hours up to now (Sent page).
 */
export function LiveStrip({
  range,
  mode,
  className,
}: {
  range: StripRange;
  mode: 'upcoming' | 'recent';
  className?: string;
}) {
  const now = useNow();
  const minute = Math.floor(now / 60_000) * 60_000;
  const span = RANGE_MS[range];
  const from = mode === 'upcoming' ? minute - 15 * 60_000 : minute - span + 5 * 60_000;
  const to = from + span;
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();
  const q = useTimeline(fromIso, toIso, now > 0);

  const data = useMemo(() => (q.data ? toStripData(q.data) : null), [q.data]);

  if (now === 0) {
    return (
      <PaceStrip
        lanes={[
          { id: 'a', label: '' },
          { id: 'b', label: '' },
          { id: 'c', label: '' },
        ]}
        points={[]}
        windows={[]}
        from={0}
        to={1}
        summary="Loading the timeline."
        loading
        className={className}
      />
    );
  }

  if (q.isError && !q.data) {
    return <ErrorBanner message={(q.error as Error).message} onRetry={() => q.refetch()} />;
  }

  const lanes = data?.lanes ?? [
    { id: 'a', label: '' },
    { id: 'b', label: '' },
    { id: 'c', label: '' },
  ];
  const totals = { pending: 0, deferred: 0, sent: 0 };
  for (const p of data?.points ?? []) {
    if (p.status === 'scheduled' || p.status === 'sending') totals.pending += p.count;
    if (p.status === 'deferred') totals.deferred += p.count;
    if (p.status === 'sent') totals.sent += p.count;
  }
  const summary =
    `${plural(lanes.length, 'sender')}. ` +
    (mode === 'upcoming'
      ? `${fmtNumber(totals.pending)} emails scheduled and ${fmtNumber(totals.deferred)} deferred between ${fmtDayTime(from)} and ${fmtDayTime(to)}.`
      : `${fmtNumber(totals.sent)} emails sent between ${fmtDayTime(from)} and ${fmtDayTime(to)}.`);

  return (
    <PaceStrip
      lanes={lanes}
      points={data?.points ?? []}
      windows={data?.windows ?? []}
      from={from}
      to={to}
      now={now}
      summary={summary}
      loading={q.isLoading}
      className={className}
    />
  );
}
