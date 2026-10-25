'use client';

import { HOUR_MS, type EmailItem, type EmailView, type SearchHit } from '@cadence/shared';
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtHourWindow, fmtNumber, fmtRelative, fmtTime, tzLabel } from '@/lib/format';
import { Button } from '../ui/button';
import { ErrorBanner, ExternalLink, Skeleton } from '../ui/misc';
import { Tooltip } from '../ui/tooltip';
import { StatusMark } from './status-mark';

export interface WindowUsage {
  label: string;
  used: number;
  cap: number;
}

export interface EmailTableProps {
  view: EmailView | 'search';
  items: (EmailItem | SearchHit)[] | undefined;
  total: number | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  /** 1-based index of the first row on this page. */
  offset: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  empty: ReactNode;
  /** Per-sender cap usage for an hour window, shown in the group row (Scheduled view). */
  usageFor?: (hourStart: number) => WindowUsage[] | undefined;
}

/**
 * Columns that drop out on small screens collapse to zero width instead of display:none, so every
 * row keeps the same column count and colSpan stays correct.
 */
const collapseMd = 'max-md:w-0 max-md:px-0 max-md:overflow-hidden max-md:[&>*]:hidden';
const collapseLg = 'max-lg:w-0 max-lg:px-0 max-lg:overflow-hidden max-lg:[&>*]:hidden';

const sortTime = (e: EmailItem, view: EmailTableProps['view']) =>
  Date.parse(view === 'sent' ? (e.finishedAt ?? e.nextAttemptAt) : e.nextAttemptAt);

function deferTooltip(e: EmailItem) {
  if (e.status !== 'deferred') return null;
  const who = e.deferScope === 'campaign' ? 'This campaign' : e.senderLabel;
  return `${who} reached ${fmtNumber(e.deferLimit ?? 0)} emails this hour. Moved to ${fmtTime(e.nextAttemptAt)}.`;
}

/** Search highlights come HTML-escaped from Elasticsearch with only <mark> added (encoder: html). */
function Highlighted({ html, fallback }: { html: string | undefined; fallback: string }) {
  if (!html) return <>{fallback}</>;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function EmailTable(props: EmailTableProps) {
  const {
    view,
    items,
    total,
    loading,
    error,
    onRetry,
    offset,
    hasPrev,
    hasNext,
    onPrev,
    onNext,
    empty,
    usageFor,
  } = props;
  const grouped = view !== 'search';
  const seen = useRef<Set<string> | null>(null);
  const fresh = useRef<Set<string>>(new Set());

  // Rows that appear while polling flash --signal-soft (design.md §9). The first load doesn't flash.
  if (items) {
    if (seen.current === null) seen.current = new Set(items.map((i) => i.id));
    else {
      fresh.current = new Set(items.filter((i) => !seen.current!.has(i.id)).map((i) => i.id));
    }
  }
  useEffect(() => {
    if (items && seen.current) for (const i of items) seen.current.add(i.id);
  }, [items]);

  const colCount = view === 'sent' ? 6 : 5;
  const zone = tzLabel();

  let body: ReactNode;
  if (error && !items) {
    body = (
      <tr>
        <td colSpan={colCount} className="p-4">
          <ErrorBanner message={error.message} onRetry={onRetry} />
        </td>
      </tr>
    );
  } else if (loading && !items) {
    body = Array.from({ length: 5 }, (_, i) => (
      <tr key={i} className="h-12 border-t border-line">
        <td className="px-4">
          <Skeleton className="h-4 w-20" />
        </td>
        <td className="px-4">
          <Skeleton className="h-4 w-40" />
        </td>
        <td className={`px-4 ${collapseMd}`}>
          <Skeleton className="h-4 w-48" />
        </td>
        <td className={`px-4 ${collapseLg}`}>
          <Skeleton className="h-4 w-16" />
        </td>
        <td className="px-4">
          <Skeleton className="h-4 w-20" />
        </td>
        {view === 'sent' && <td className={`px-4 ${collapseMd}`} />}
      </tr>
    ));
  } else if (items && items.length === 0) {
    body = (
      <tr>
        <td colSpan={colCount} className="px-6 py-12">
          {empty}
        </td>
      </tr>
    );
  } else {
    let lastHour: number | null = null;
    body = items!.map((e, idx) => {
      const t = sortTime(e, view);
      const hour = Math.floor(t / HOUR_MS) * HOUR_MS;
      const showGroup = grouped && hour !== lastHour;
      const continued = showGroup && idx === 0 && offset > 1;
      lastHour = hour;
      const usage = showGroup ? usageFor?.(hour) : undefined;
      const hit = e as SearchHit;
      const deferNote = deferTooltip(e);
      const timeIso = view === 'sent' ? (e.finishedAt ?? e.nextAttemptAt) : e.nextAttemptAt;
      return (
        <Fragment key={e.id}>
          {showGroup && (
            <tr className="h-9 border-t border-line bg-sunken">
              <th scope="rowgroup" colSpan={colCount} className="px-4 text-left font-normal">
                <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
                  <span className="text-label font-semibold text-ink">
                    {fmtHourWindow(hour)}
                    {continued && <span className="font-normal text-ink-3"> (continued)</span>}
                  </span>
                  {usage && usage.length > 0 && (
                    <span className="flex flex-wrap gap-x-4 text-caption tabular text-ink-2">
                      {usage.map((u) => (
                        <span key={u.label} className={cn(u.used >= u.cap && 'text-deferred')}>
                          {u.label} {fmtNumber(u.used)}/{fmtNumber(u.cap)}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              </th>
            </tr>
          )}
          <tr
            className={cn(
              'h-12 border-t border-line transition-colors duration-150 hover:bg-sunken',
              fresh.current.has(e.id) && 'animate-flash',
            )}
          >
            <td className="w-32 px-4 py-1.5 align-middle whitespace-nowrap max-md:w-24 max-md:pr-2">
              <Tooltip content={`${fmtDateTime(timeIso)}, ${fmtRelative(timeIso)}. ${zone}`}>
                <span className="time text-ink" tabIndex={-1}>
                  {fmtTime(timeIso, { seconds: true })}
                </span>
              </Tooltip>
              {e.status === 'deferred' && e.scheduledAt !== e.nextAttemptAt && (
                <div className="text-caption text-ink-3">was {fmtTime(e.scheduledAt)}</div>
              )}
            </td>
            <td className="max-w-0 px-4 py-1.5">
              <Tooltip content={e.recipient}>
                <span className="block truncate text-ink">
                  <Highlighted html={hit.highlights?.recipient?.[0]} fallback={e.recipient} />
                </span>
              </Tooltip>
              <span className="block truncate text-caption text-ink-3 md:hidden">{e.subject}</span>
            </td>
            <td className={`max-w-0 px-4 py-1.5 ${collapseMd}`}>
              <Tooltip content={e.subject}>
                <span className="block truncate text-ink-2">
                  <Highlighted html={hit.highlights?.subject?.[0]} fallback={e.subject} />
                </span>
              </Tooltip>
              {e.status === 'failed' && e.error && (
                <span className="block truncate text-caption text-failed" title={e.error}>
                  {e.error}
                </span>
              )}
              {hit.highlights?.body?.[0] && (
                <span className="block truncate text-caption text-ink-3">
                  <Highlighted html={hit.highlights.body[0]} fallback="" />
                </span>
              )}
            </td>
            <td className={`w-28 px-4 py-1.5 whitespace-nowrap text-ink-2 ${collapseLg}`}>
              <span>{e.senderLabel}</span>
            </td>
            <td className="w-40 px-4 py-1.5 whitespace-nowrap max-md:w-28 max-md:pl-2">
              {deferNote ? (
                <Tooltip content={deferNote}>
                  <button type="button" className="rounded-control">
                    <StatusMark status={e.status} />
                    <span className="sr-only">. {deferNote}</span>
                  </button>
                </Tooltip>
              ) : (
                <StatusMark status={e.status} />
              )}
            </td>
            {view === 'sent' && (
              <td className={`w-44 px-4 py-1.5 whitespace-nowrap ${collapseMd}`}>
                <span>
                  {e.previewUrl && (
                    <ExternalLink href={e.previewUrl}>View in Ethereal</ExternalLink>
                  )}
                </span>
              </td>
            )}
          </tr>
        </Fragment>
      );
    });
  }

  const first = items && items.length > 0 ? offset : 0;
  const last = items ? offset + items.length - 1 : 0;

  return (
    <div className="overflow-hidden rounded-panel border border-line bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-body">
          <thead className="sticky top-0 z-[1] bg-sunken">
            <tr className="h-9 text-left text-label text-ink-2">
              <th scope="col" className="w-32 px-4 font-medium max-md:w-24 max-md:pr-2">
                Time
              </th>
              <th scope="col" className="px-4 font-medium">
                Recipient
              </th>
              <th scope="col" className={`px-4 font-medium ${collapseMd}`}>
                <span>Subject</span>
              </th>
              <th scope="col" className={`w-28 px-4 font-medium ${collapseLg}`}>
                <span>Sender</span>
              </th>
              <th scope="col" className="w-40 px-4 font-medium max-md:w-28 max-md:pl-2">
                Status
              </th>
              {view === 'sent' && (
                <th scope="col" className={`w-44 px-4 font-medium ${collapseMd}`}>
                  <span className="sr-only">Preview</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody aria-busy={loading || undefined}>{body}</tbody>
        </table>
      </div>
      {(total ?? 0) > 0 && (
        <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-2.5">
          <p className="text-caption tabular text-ink-2" aria-live="polite">
            {fmtNumber(first)}–{fmtNumber(last)} of {fmtNumber(total ?? 0)}
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={onPrev} disabled={!hasPrev}>
              Previous
            </Button>
            <Button size="sm" onClick={onNext} disabled={!hasNext}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Left-aligned empty state: title, one line, optional action (design.md §7.7). */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <p className="text-section text-ink">{title}</p>
      <p className="text-body text-ink-2">{body}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
