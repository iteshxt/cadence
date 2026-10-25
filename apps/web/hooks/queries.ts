'use client';

import type {
  AppConfig,
  EmailStatus,
  EmailView,
  EmailsPage,
  SearchPage,
  SenderDto,
  SlackStatus,
  Stats,
  Timeline,
} from '@cadence/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Polling cadence for live views (SCH-6). TanStack pauses it while the tab is hidden. */
export const POLL_MS = 5_000;

export const queryKeys = {
  emails: (view: EmailView, cursor: string | null) => ['emails', view, cursor] as const,
  stats: ['stats'] as const,
  timeline: (from: string, to: string) => ['timeline', from, to] as const,
  search: (q: string, status: EmailStatus | null, cursor: string | null) =>
    ['search', q, status, cursor] as const,
  slack: ['slack'] as const,
  senders: ['senders'] as const,
  config: ['config'] as const,
};

export function useEmails(view: EmailView, cursor: string | null) {
  return useQuery({
    queryKey: queryKeys.emails(view, cursor),
    queryFn: ({ signal }) =>
      api<EmailsPage>(
        `/api/emails?view=${view}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        { signal },
      ),
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  });
}

export function useStats() {
  return useQuery({
    queryKey: queryKeys.stats,
    queryFn: ({ signal }) => api<Stats>('/api/stats', { signal }),
    refetchInterval: POLL_MS,
  });
}

/** The pace strip's data. `from`/`to` are rounded by the caller so the key stays stable between polls. */
export function useTimeline(from: string, to: string, enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.timeline(from, to),
    queryFn: ({ signal }) =>
      api<Timeline>(`/api/timeline?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        signal,
      }),
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
  });
}

export function useSearch(q: string, status: EmailStatus | null, cursor: string | null) {
  return useQuery({
    queryKey: queryKeys.search(q, status, cursor),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ q });
      if (status) params.set('status', status);
      if (cursor) params.set('cursor', cursor);
      return api<SearchPage>(`/api/search?${params}`, { signal });
    },
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useSenders(opts: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.senders,
    queryFn: ({ signal }) =>
      api<{ items: SenderDto[] }>('/api/senders', { signal }).then((r) => r.items),
    refetchInterval: opts.poll ? POLL_MS : false,
  });
}

export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: ({ signal }) => api<AppConfig>('/api/config', { signal }),
    staleTime: 5 * 60_000,
  });
}

export function useSlackStatus() {
  return useQuery({
    queryKey: queryKeys.slack,
    queryFn: ({ signal }) => api<SlackStatus>('/api/integrations/slack', { signal }),
  });
}
