'use client';

import { LIMITS, type SenderDto, type UserSettings } from '@cadence/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { queryKeys, useConfig, useSenders, useSettings, useSlackStatus } from '@/hooks/queries';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDuration, fmtNumber, fmtTime } from '@/lib/format';
import { GoogleG, SlackLogo } from '../brand/third-party';
import { Button } from '../ui/button';
import { Field, describedBy } from '../ui/field';
import { Input, NumberInput } from '../ui/input';
import { ErrorBanner, Skeleton } from '../ui/misc';

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  /** A control on the right of the title row, such as Connect Gmail. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-line py-8 first:border-t-0 first:pt-0">
      <div className="grid items-start gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h2 className="text-section text-ink">{title}</h2>
          {description && <p className="mt-1 text-body text-ink-2">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** Shows the result of an OAuth round trip once (`?<param>=…`), then clears it from the URL. */
function useOAuthResult(
  param: string,
  results: Record<string, { kind: 'success' | 'error' | 'info'; text: string }>,
) {
  const params = useSearchParams();
  const router = useRouter();
  const announced = useRef(false);
  useEffect(() => {
    const result = params.get(param);
    if (!result || announced.current) return;
    announced.current = true;
    const r = results[result];
    if (r) toast[r.kind](r.text);
    router.replace('/dashboard/settings', { scroll: false });
  }, [param, params, results, router]);
}

const SLACK_RESULT: Record<string, { kind: 'success' | 'error' | 'info'; text: string }> = {
  connected: { kind: 'success', text: 'Slack connected.' },
  cancelled: { kind: 'info', text: 'Slack connection cancelled.' },
  error: { kind: 'error', text: 'Couldn’t connect Slack. Try again.' },
};

export function SlackSection() {
  const status = useSlackStatus();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  useOAuthResult('slack', SLACK_RESULT);

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

const GMAIL_RESULT: Record<string, { kind: 'success' | 'error' | 'info'; text: string }> = {
  connected: { kind: 'success', text: 'Gmail connected.' },
  cancelled: { kind: 'info', text: 'Gmail wasn’t connected.' },
  scope: {
    kind: 'error',
    text: 'Cadence needs permission to send email. Connect again and leave the Gmail box ticked.',
  },
  error: { kind: 'error', text: 'Couldn’t connect Gmail. Try again.' },
};

/** Connect Gmail and Reconnect run the web app's Google flow in connect mode (tech-spec §6.1). */
function useConnectGmail() {
  const [isPending, setPending] = useState(false);
  return {
    isPending,
    mutate: () => {
      setPending(true);
      window.location.assign('/auth/google?mode=connect');
    },
  };
}

/** One sender: label, address, limit and usage; Edit expands the row in place (design.md §8.4). */
function SenderRow({ sender, maxCap }: { sender: SenderDto; maxCap: number | undefined }) {
  const queryClient = useQueryClient();
  const connect = useConnectGmail();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [label, setLabel] = useState(sender.label);
  const [displayName, setDisplayName] = useState(sender.displayName ?? '');
  const [limit, setLimit] = useState(String(sender.cap));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const id = `sender-${sender.id}`;

  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.senders });
  const save = useMutation({
    mutationFn: () =>
      api<SenderDto>(`/api/senders/${sender.id}`, {
        method: 'PATCH',
        body: { label, displayName, hourlyLimit: Number(limit) },
      }),
    onSuccess: () => {
      toast.success('Sender saved.');
      setEditing(false);
      setErrors({});
      refresh();
    },
    onError: (err: Error) => {
      const fields = err instanceof ApiError ? err.fields : {};
      if (Object.keys(fields).length > 0) setErrors(fields);
      else toast.error(err.message);
    },
  });
  const disconnect = useMutation({
    mutationFn: () => api(`/api/senders/${sender.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(`${sender.label} disconnected.`);
      refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const startEditing = () => {
    setLabel(sender.label);
    setDisplayName(sender.displayName ?? '');
    setLimit(String(sender.cap));
    setErrors({});
    setConfirming(false);
    setEditing(true);
  };

  return (
    <li className="py-4 first:pt-0">
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,1fr)_180px_180px] sm:items-center">
        <div className="min-w-0">
          <p className="truncate text-body font-semibold text-ink">{sender.label}</p>
          <p className="truncate text-caption text-ink-2">{sender.fromEmail}</p>
          {sender.status === 'reconnect' ? (
            <p className="mt-0.5 text-caption text-deferred">Reconnect needed</p>
          ) : (
            sender.displayName && (
              <p className="truncate text-caption text-ink-3">Sends as {sender.displayName}</p>
            )
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-label text-ink tabular">{fmtNumber(sender.cap)} an hour</p>
          <UsageMeter sender={sender} />
        </div>
        <div className="flex gap-2 sm:justify-end">
          {sender.status === 'reconnect' && (
            <Button loading={connect.isPending} onClick={() => connect.mutate()}>
              Reconnect
            </Button>
          )}
          {!editing && (
            <Button variant="ghost" onClick={startEditing}>
              Edit
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <form
          className="mt-4 flex flex-col gap-4 rounded-panel bg-sunken p-4"
          onSubmit={(e) => (e.preventDefault(), save.mutate())}
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={`${id}-label`} label="Label" error={errors.label} required>
              <Input
                id={`${id}-label`}
                value={label}
                maxLength={LIMITS.SENDER_LABEL_MAX}
                onChange={(e) => setLabel(e.target.value)}
                {...describedBy(`${id}-label`, errors.label)}
              />
            </Field>
            <Field
              id={`${id}-name`}
              label="Display name"
              error={errors.displayName}
              helper="The name recipients see. Leave empty to show the address only."
            >
              <Input
                id={`${id}-name`}
                value={displayName}
                maxLength={LIMITS.SENDER_DISPLAY_NAME_MAX}
                onChange={(e) => setDisplayName(e.target.value)}
                {...describedBy(`${id}-name`, errors.displayName, true)}
              />
            </Field>
          </div>
          <Field
            id={`${id}-limit`}
            label="Hourly limit"
            error={errors.hourlyLimit}
            helper={maxCap ? `Up to ${fmtNumber(maxCap)}, the server maximum.` : undefined}
            className="sm:max-w-[calc(50%-8px)]"
          >
            <NumberInput
              id={`${id}-limit`}
              unit="emails per hour"
              min={1}
              max={maxCap}
              step={1}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              {...describedBy(`${id}-limit`, errors.hourlyLimit, Boolean(maxCap))}
            />
          </Field>
          {confirming ? (
            <div
              role="alertdialog"
              aria-label="Disconnect this sender?"
              className="flex flex-wrap items-center justify-end gap-2"
            >
              <p className="mr-auto text-body text-ink">
                Disconnect this sender? Its scheduled emails will fail instead of sending.
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
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost-danger"
                className="mr-auto"
                onClick={() => setConfirming(true)}
              >
                Disconnect
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={save.isPending}>
                Save
              </Button>
            </div>
          )}
        </form>
      )}
    </li>
  );
}

export function SendersSection() {
  const senders = useSenders({ poll: true });
  const config = useConfig();
  const connect = useConnectGmail();
  useOAuthResult('gmail', GMAIL_RESULT);

  const connectButton = (
    <Button loading={connect.isPending} onClick={() => connect.mutate()}>
      <GoogleG /> Connect Gmail
    </Button>
  );

  return (
    <Section
      title="Senders"
      description="Your Gmail accounts. Campaigns send from them in turn, each up to its own hourly limit."
      action={connectButton}
    >
      {senders.isLoading ? (
        <div className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : senders.isError ? (
        <ErrorBanner message={senders.error.message} onRetry={() => senders.refetch()} />
      ) : senders.data!.length === 0 ? (
        <p className="rounded-panel border border-dashed border-line p-6 text-center text-body text-ink-2">
          No Gmail accounts connected. Connect one to send campaigns from it.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {senders.data!.map((s) => (
            <SenderRow key={s.id} sender={s} maxCap={config.data?.maxPerHourPerSender} />
          ))}
        </ul>
      )}
    </Section>
  );
}

export function DefaultsSection() {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [delay, setDelay] = useState<string | null>(null);
  const [hourly, setHourly] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const delayValue = delay ?? String(settings.data?.defaultDelaySeconds ?? '');
  const hourlyValue = hourly ?? String(settings.data?.defaultHourlyLimit ?? '');

  const save = useMutation({
    mutationFn: () =>
      api<UserSettings>('/api/settings', {
        method: 'PUT',
        body: { defaultDelaySeconds: Number(delayValue), defaultHourlyLimit: Number(hourlyValue) },
      }),
    onSuccess: (saved) => {
      toast.success('Defaults saved.');
      queryClient.setQueryData(queryKeys.settings, saved);
      setDelay(null);
      setHourly(null);
      setErrors({});
    },
    onError: (err: Error) => {
      const fields = err instanceof ApiError ? err.fields : {};
      if (Object.keys(fields).length > 0) setErrors(fields);
      else toast.error(err.message);
    },
  });

  return (
    <Section title="Campaign defaults" description="Compose starts with these values.">
      {settings.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : settings.isError ? (
        <ErrorBanner message={settings.error.message} onRetry={() => settings.refetch()} />
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => (e.preventDefault(), save.mutate())}
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="default-delay"
              label="Delay between emails"
              error={errors.defaultDelaySeconds}
            >
              <NumberInput
                id="default-delay"
                unit="seconds"
                min={LIMITS.DELAY_MIN_SECONDS}
                max={LIMITS.DELAY_MAX_SECONDS}
                step={1}
                value={delayValue}
                onChange={(e) => setDelay(e.target.value)}
                {...describedBy('default-delay', errors.defaultDelaySeconds)}
              />
            </Field>
            <Field id="default-hourly" label="Hourly limit" error={errors.defaultHourlyLimit}>
              <NumberInput
                id="default-hourly"
                unit="emails per hour"
                min={LIMITS.HOURLY_MIN}
                max={LIMITS.HOURLY_MAX}
                step={1}
                value={hourlyValue}
                onChange={(e) => setHourly(e.target.value)}
                {...describedBy('default-hourly', errors.defaultHourlyLimit)}
              />
            </Field>
          </div>
          <div>
            <Button
              type="submit"
              loading={save.isPending}
              disabled={delay === null && hourly === null}
            >
              Save defaults
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

export function LimitsSection() {
  const config = useConfig();
  const rows = config.data
    ? [
        ['Minimum gap between sends from one sender', fmtDuration(config.data.minSendGapMs)],
        [
          'Highest hourly limit for a sender',
          `${fmtNumber(config.data.maxPerHourPerSender)} emails`,
        ],
        ['Emails sent in parallel', fmtNumber(config.data.workerConcurrency)],
        ['Recipients per campaign', `Up to ${fmtNumber(config.data.maxRecipients)}`],
      ]
    : [];
  return (
    <Section title="Server limits" description="These are set on the server.">
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
