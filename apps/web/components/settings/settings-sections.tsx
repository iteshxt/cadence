'use client';

import type { SenderDto } from '@cadence/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { queryKeys, useConfig, useSenders, useSlackStatus } from '@/hooks/queries';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { publicEnv } from '@/lib/env';
import { fmtDuration, fmtNumber, fmtTime } from '@/lib/format';
import { SlackLogo } from '../brand/third-party';
import { Button } from '../ui/button';
import { ErrorBanner, ExternalLink, Skeleton } from '../ui/misc';

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line py-8 first:border-t-0 first:pt-0">
      <h2 className="text-section text-ink">{title}</h2>
      {description && <p className="mt-1 text-body text-ink-2">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

const SLACK_RESULT: Record<string, { kind: 'success' | 'error' | 'info'; text: string }> = {
  connected: { kind: 'success', text: 'Slack connected.' },
  cancelled: { kind: 'info', text: 'Slack connection cancelled.' },
  error: { kind: 'error', text: 'Couldn’t connect Slack. Try again.' },
};

export function SlackSection() {
  const status = useSlackStatus();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const announced = useRef(false);

  // Result of the OAuth round trip, shown once (?slack=connected|cancelled|error).
  useEffect(() => {
    const result = params.get('slack');
    if (!result || announced.current) return;
    announced.current = true;
    const r = SLACK_RESULT[result];
    if (r) toast[r.kind](r.text);
    router.replace('/dashboard/settings', { scroll: false });
  }, [params, router]);

  const connect = useMutation({
    mutationFn: () => api<{ url: string }>('/api/integrations/slack/authorize', { method: 'POST' }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (err: Error) => toast.error(err.message),
  });
  const test = useMutation({
    mutationFn: () => api('/api/integrations/slack/test', { method: 'POST' }),
    onSuccess: () => toast.success('Test message sent to Slack.'),
    onError: (err: Error) => {
      toast.error(err.message);
      void queryClient.invalidateQueries({ queryKey: queryKeys.slack });
    },
  });
  const disconnect = useMutation({
    mutationFn: () => api('/api/integrations/slack', { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Slack disconnected.');
      setConfirming(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.slack });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Section title="Slack">
      {status.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : status.isError ? (
        <ErrorBanner message={status.error.message} onRetry={() => status.refetch()} />
      ) : status.data?.connected ? (
        <div className="flex flex-col gap-4">
          <p className="flex items-center gap-2 text-body text-ink">
            <span aria-hidden className="size-2 rounded-full bg-ink" />
            <span>
              Connected to <strong className="font-semibold">#{status.data.channelName}</strong> in{' '}
              <strong className="font-semibold">{status.data.teamName}</strong>
            </span>
          </p>
          {confirming ? (
            <div
              role="alertdialog"
              aria-label="Disconnect Slack?"
              className="flex flex-wrap items-center gap-2"
            >
              <p className="mr-2 text-body text-ink">
                Disconnect Slack? Limit alerts stop until you connect again.
              </p>
              <Button variant="ghost" onClick={() => setConfirming(false)} autoFocus>
                Keep connected
              </Button>
              <Button
                variant="destructive"
                loading={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button loading={test.isPending} onClick={() => test.mutate()}>
                Send test message
              </Button>
              <Button variant="ghost-danger" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <SlackLogo />
          <p className="flex-1 text-body text-ink-2">
            Get a Slack message when a sender reaches its hourly limit.
          </p>
          <Button variant="primary" loading={connect.isPending} onClick={() => connect.mutate()}>
            Connect Slack
          </Button>
        </div>
      )}
    </Section>
  );
}

/** 4 px bar; --ink-2 fill, --deferred-mark from 80% (design.md §7.7). */
export function UsageMeter({ sender }: { sender: SenderDto }) {
  const ratio = Math.min(1, sender.usedThisHour / Math.max(1, sender.cap));
  const full = sender.usedThisHour >= sender.cap;
  return (
    <div className="flex flex-col gap-1">
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={sender.cap}
        aria-valuenow={sender.usedThisHour}
        aria-label={`${sender.label} usage this hour`}
        className="h-1 w-full overflow-hidden rounded-full bg-sunken"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-300',
            ratio >= 0.8 ? 'bg-deferred-mark' : 'bg-ink-2',
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
      <p className={cn('text-caption tabular', full ? 'text-deferred' : 'text-ink-3')}>
        {fmtNumber(sender.usedThisHour)} of {fmtNumber(sender.cap)}
        {full ? `. Resets at ${fmtTime(sender.resetsAt)}.` : ' this hour'}
      </p>
    </div>
  );
}

export function SendersSection() {
  const senders = useSenders({ poll: true });
  return (
    <Section
      title="Senders"
      description="Emails are spread across these accounts in turn. Each has its own hourly limit."
    >
      {senders.isLoading ? (
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : senders.isError ? (
        <ErrorBanner message={senders.error.message} onRetry={() => senders.refetch()} />
      ) : senders.data!.length === 0 ? (
        <p className="text-body text-ink-2">
          No sender accounts yet. Run the seed script on the server to add them.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {senders.data!.map((s) => (
            <li
              key={s.id}
              className="grid gap-x-6 gap-y-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center"
            >
              <div className="min-w-0">
                <p className="text-body font-medium text-ink">{s.label}</p>
                <p className="truncate text-caption text-ink-2">{s.fromEmail}</p>
              </div>
              <UsageMeter sender={s} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function LimitsSection() {
  const config = useConfig();
  const rows = config.data
    ? [
        ['Minimum gap between sends from one sender', fmtDuration(config.data.minSendGapMs)],
        ['Hourly limit per sender', `${fmtNumber(config.data.maxPerHourPerSender)} emails`],
        ['Emails sent in parallel', fmtNumber(config.data.workerConcurrency)],
        ['Recipients per campaign', `Up to ${fmtNumber(config.data.maxRecipients)}`],
      ]
    : [];
  return (
    <Section title="Sending limits" description="These are set on the server.">
      {config.isLoading ? (
        <Skeleton className="h-28 w-full" />
      ) : config.isError ? (
        <ErrorBanner message={config.error.message} onRetry={() => config.refetch()} />
      ) : (
        <dl className="divide-y divide-line">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-6 py-2.5 first:pt-0">
              <dt className="text-body text-ink-2">{k}</dt>
              <dd className="time text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </Section>
  );
}

export function QueueSection() {
  return (
    <Section
      title="Queue dashboard"
      description="Live view of scheduled, active, delayed, and failed jobs. Asks for the admin password."
    >
      <ExternalLink href={`${publicEnv.apiUrl}/admin/queues`}>Open queue dashboard</ExternalLink>
    </Section>
  );
}
