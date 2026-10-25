'use client';

import { HOUR_MS, LIMITS, type EmailView as View } from '@cadence/shared';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useEmails, useStats, useTimeline } from '@/hooks/queries';
import { usePager } from '@/hooks/use-pager';
import { fmtDayTime, fmtNumber, fmtTime } from '@/lib/format';
import { PageHead } from '../layout/page-head';
import { LiveStrip, type StripRange } from '../pace/live-strip';
import { Readouts, type Readout } from '../pace/readouts';
import { Button } from '../ui/button';
import { Segmented } from '../ui/misc';
import { EmailTable, EmptyState, type WindowUsage } from './email-table';

const rise = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

function useOpenCompose() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return () => {
    const next = new URLSearchParams(params.toString());
    next.set('compose', '1');
    router.push(`${pathname}?${next}`, { scroll: false });
  };
}

/** Per-sender usage for the hour groups, from the same timeline the strip shows. */
function useWindowUsage(enabled: boolean) {
  const [minute, setMinute] = useState(0);
  useEffect(() => {
    const tick = () => setMinute(Math.floor(Date.now() / 60_000) * 60_000);
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  const from = new Date(minute - 15 * 60_000).toISOString();
  const to = new Date(minute - 15 * 60_000 + 24 * HOUR_MS).toISOString();
  const tl = useTimeline(from, to, enabled && minute > 0);
  return useMemo(() => {
    if (!enabled || !tl.data) return undefined;
    const labels = new Map(tl.data.senders.map((s) => [s.id, s.label]));
    const byHour = new Map<number, WindowUsage[]>();
    for (const w of tl.data.windows) {
      const h = Date.parse(w.hourStart);
      const list = byHour.get(h) ?? [];
      if (w.used > 0)
        list.push({ label: labels.get(w.senderId) ?? 'Sender', used: w.used, cap: w.cap });
      byHour.set(h, list);
    }
    return (hourStart: number) => byHour.get(hourStart);
  }, [enabled, tl.data]);
}

export function EmailView({ view }: { view: View }) {
  const [range, setRange] = useState<StripRange>('3h');
  const pager = usePager(LIMITS.PAGE_SIZE);
  const emails = useEmails(view, pager.cursor);
  const stats = useStats();
  const usageFor = useWindowUsage(view === 'scheduled');
  const openCompose = useOpenCompose();
  const s = stats.data;

  const readouts: Readout[] =
    view === 'scheduled'
      ? [
          {
            label: 'Next send',
            value: s?.nextSendAt ? fmtTime(s.nextSendAt, { seconds: true }) : 'None',
          },
          {
            label: 'Finishes around',
            value: s?.lastPlannedAt ? fmtDayTime(s.lastPlannedAt) : 'None',
          },
          {
            label: 'Deferred',
            value: fmtNumber(s?.deferred ?? 0),
            tone: s?.deferred ? 'deferred' : 'default',
          },
          {
            label: 'Failed',
            value: fmtNumber(s?.failed ?? 0),
            tone: s?.failed ? 'failed' : 'default',
          },
        ]
      : [
          { label: 'Sent today', value: fmtNumber(s?.sentToday ?? 0), hint: 'Since midnight UTC' },
          { label: 'Sent in the last hour', value: fmtNumber(s?.sentLastHour ?? 0) },
          {
            label: 'Failed',
            value: fmtNumber(s?.failed ?? 0),
            tone: s?.failed ? 'failed' : 'default',
          },
        ];

  return (
    <div className="flex flex-col gap-8">
      <PageHead
        title={view === 'scheduled' ? 'Scheduled' : 'Sent'}
        description={
          view === 'scheduled'
            ? 'Every email waiting to go out, on the minute it will send.'
            : 'Everything that has gone out or failed, with when it happened.'
        }
        actions={
          view === 'scheduled' && (
            <Segmented
              label="Time range"
              value={range}
              onChange={setRange}
              options={[
                { value: '3h', label: '3 h' },
                { value: '12h', label: '12 h' },
                { value: '24h', label: '24 h' },
              ]}
            />
          )
        }
      />

      {/* The strip floats on the same soft teal glow as the landing hero's queue. */}
      <div style={rise(80)} className="relative motion-safe:animate-rise">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-x-[6%] -inset-y-[40%] blur-3xl"
          style={{
            background:
              'radial-gradient(closest-side, color-mix(in oklab, var(--signal) 26%, transparent), color-mix(in oklab, var(--signal) 10%, transparent) 60%, transparent)',
          }}
        />
        <LiveStrip
          range={view === 'scheduled' ? range : '3h'}
          mode={view === 'scheduled' ? 'upcoming' : 'recent'}
          className="relative p-5 shadow-float max-sm:p-4"
        />
      </div>

      <Readouts
        band
        items={readouts}
        loading={stats.isLoading}
        style={rise(160)}
        className="motion-safe:animate-rise"
      />

      <div style={rise(240)} className="motion-safe:animate-rise">
        <EmailTable
          view={view}
          items={emails.data?.items}
          total={emails.data?.total}
          loading={emails.isLoading}
          error={emails.error}
          onRetry={() => emails.refetch()}
          offset={pager.offset}
          hasPrev={pager.hasPrev}
          hasNext={Boolean(emails.data?.nextCursor)}
          onPrev={pager.prev}
          onNext={() => pager.next(emails.data?.nextCursor ?? null)}
          usageFor={usageFor}
          empty={
            view === 'scheduled' ? (
              <EmptyState
                title="No emails scheduled"
                body="Compose a campaign and its sends will appear here and on the strip above."
                action={<Button onClick={openCompose}>Compose</Button>}
              />
            ) : (
              <EmptyState
                title="Nothing sent yet"
                body="Sent and failed emails appear here once their time comes."
              />
            )
          }
        />
      </div>
    </div>
  );
}
