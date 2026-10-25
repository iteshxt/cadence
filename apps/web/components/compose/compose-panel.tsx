'use client';

import {
  LIMITS,
  campaignIntervalMs,
  type CreateCampaignInput,
  type CreateCampaignResponse,
} from '@cadence/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Timer, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Dialog } from 'radix-ui';
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { useConfig, useSenders } from '@/hooks/queries';
import { ApiError, api } from '@/lib/api';
import {
  fmtDayTime,
  fmtInterval,
  fmtNumber,
  fmtTime,
  fromLocalInputs,
  toLocalInputs,
  tzLabel,
} from '@/lib/format';
import { Button } from '../ui/button';
import { Field, describedBy } from '../ui/field';
import { Input, NumberInput, Textarea } from '../ui/input';
import { Switch } from '../ui/misc';
import { ComposePreview, useEstimate } from './compose-preview';
import { RecipientsDropzone, type RecipientsFile } from './recipients-dropzone';
import { SenderChips } from './sender-chips';

interface FormValues {
  subject: string;
  body: string;
  startDate: string;
  startTime: string;
  sendNow: boolean;
  delaySeconds: number;
  hourlyLimit: number;
}

function defaults(): FormValues {
  const in10 = toLocalInputs(Date.now() + 10 * 60_000);
  return {
    subject: '',
    body: '',
    startDate: in10.date,
    startTime: in10.time,
    sendNow: false,
    delaySeconds: LIMITS.DELAY_DEFAULT_SECONDS,
    hourlyLimit: LIMITS.HOURLY_DEFAULT,
  };
}

/**
 * Opens Compose by adding `?compose=1`. The history API updates `useSearchParams` without the
 * server round trip a router navigation makes, so the panel opens immediately.
 */
export function useOpenCompose() {
  return () => {
    const url = new URL(window.location.href);
    url.searchParams.set('compose', '1');
    window.history.pushState(null, '', url);
  };
}

/** Opens over any dashboard page when the URL has `?compose=1` (design.md §7.5). */
export function ComposePanel() {
  const urlOpen = useSearchParams().get('compose') === '1';
  // Local state closes the panel on the click itself; the URL catches up after.
  const [open, setOpen] = useState(urlOpen);
  // A new key per opening resets the form and generates a new Idempotency-Key. It changes on
  // open, not on close, so the panel keeps its content while it slides out.
  const [session, setSession] = useState(0);

  useEffect(() => {
    setOpen(urlOpen);
    if (urlOpen) setSession((s) => s + 1);
  }, [urlOpen]);

  const close = () => {
    setOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('compose');
    window.history.replaceState(null, '', url);
  };

  // Escape and outside clicks go through the form, which asks before discarding changes.
  const requestClose = useRef(close);

  // Overlay and Content must be the Portal's direct children: Radix waits for their exit
  // animations only when it can see their DOM nodes.
  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgb(15_18_17/0.4)] motion-safe:data-[state=closed]:animate-fade-out motion-safe:data-[state=open]:animate-fade-in" />
        <Dialog.Content
          onEscapeKeyDown={(ev) => (ev.preventDefault(), requestClose.current())}
          onPointerDownOutside={(ev) => (ev.preventDefault(), requestClose.current())}
          onInteractOutside={(ev) => ev.preventDefault()}
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[920px] flex-col bg-surface shadow-float outline-none will-change-transform motion-safe:data-[state=closed]:animate-panel-out motion-safe:data-[state=open]:animate-panel-in"
        >
          <ComposeForm key={session} onClose={close} requestCloseRef={requestClose} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A numbered group of fields, like the landing page's campaign steps. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-line pt-6 first:border-t-0 first:pt-0">
      <h3 className="flex items-center gap-3 text-section text-ink">
        <span
          aria-hidden
          className="flex size-7 items-center justify-center rounded-control bg-signal-soft text-label text-signal tabular"
        >
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function ComposeForm({
  onClose,
  requestCloseRef,
}: {
  onClose: () => void;
  requestCloseRef: RefObject<() => void>;
}) {
  const queryClient = useQueryClient();
  const senders = useSenders();
  const config = useConfig();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [recipients, setRecipients] = useState<RecipientsFile | null>(null);
  const [recipientsError, setRecipientsError] = useState<string>();
  const [senderIds, setSenderIds] = useState<string[] | null>(null);
  const [senderError, setSenderError] = useState<string>();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const form = useForm<FormValues>({ defaultValues: defaults(), mode: 'onTouched' });
  const { register, handleSubmit, setError, control, formState } = form;
  const values = useWatch({ control });

  // Default to every sender once they load.
  useEffect(() => {
    if (senderIds === null && senders.data) setSenderIds(senders.data.map((s) => s.id));
  }, [senders.data, senderIds]);

  const chosen = useMemo(
    () => (senders.data ?? []).filter((s) => senderIds?.includes(s.id)),
    [senders.data, senderIds],
  );
  const delay = Number(values.delaySeconds);
  const hourly = Number(values.hourlyLimit);
  const pacingValid =
    Number.isInteger(delay) &&
    delay >= LIMITS.DELAY_MIN_SECONDS &&
    delay <= LIMITS.DELAY_MAX_SECONDS &&
    Number.isInteger(hourly) &&
    hourly >= LIMITS.HOURLY_MIN &&
    hourly <= LIMITS.HOURLY_MAX;
  const intervalMs = pacingValid ? campaignIntervalMs(delay, hourly) : null;
  const startMs = values.sendNow
    ? Date.now()
    : fromLocalInputs(values.startDate ?? '', values.startTime ?? '');

  const previewInput = useDeferredValue(
    useMemo(
      () =>
        recipients && intervalMs && config.data && chosen.length > 0
          ? {
              count: recipients.emails.length,
              startMs: Number.isFinite(startMs) ? Math.max(startMs, Date.now()) : Date.now(),
              intervalMs,
              senders: chosen,
              maxPerHourPerSender: config.data.maxPerHourPerSender,
              minSendGapMs: config.data.minSendGapMs,
            }
          : null,
      // startMs changes every render in "send now" mode; round it to the minute.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [recipients, intervalMs, config.data, chosen, Math.floor(startMs / 60_000)],
    ),
  );
  const estimate = useEstimate(previewInput);

  const dirty = formState.isDirty || recipients !== null;
  const requestClose = () => (dirty ? setConfirmDiscard(true) : onClose());
  useEffect(() => {
    requestCloseRef.current = requestClose;
  });

  const mutation = useMutation({
    mutationFn: (body: CreateCampaignInput) =>
      api<CreateCampaignResponse>('/api/campaigns', {
        method: 'POST',
        body,
        headers: { 'idempotency-key': idempotencyKey },
      }).catch((err: unknown) => {
        // A repeated submit of the same campaign is a success (tech-spec §5).
        if (err instanceof ApiError && err.code === 'DUPLICATE_REQUEST')
          return err.details as CreateCampaignResponse;
        throw err;
      }),
    onSuccess: (res) => {
      toast.success(
        `${fmtNumber(res.scheduled)} emails scheduled. First send at ${fmtTime(res.firstAt)}.`,
      );
      void queryClient.invalidateQueries({ queryKey: ['emails'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['timeline'] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        const fields = err.fields;
        let placed = false;
        for (const [path, message] of Object.entries(fields)) {
          const key = path.split('.')[0];
          if (key === 'recipients') setRecipientsError(message);
          else if (key === 'senderIds') setSenderError(message);
          else if (key === 'startAt') setError('startTime', { message });
          else if (key && key in defaults()) setError(key as keyof FormValues, { message });
          else continue;
          placed = true;
        }
        if (placed) return;
      }
      if (err instanceof ApiError && err.code === 'START_IN_PAST') {
        setError('startTime', { message: err.message });
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Couldn’t schedule this campaign.');
    },
  });

  const onSubmit = handleSubmit((v) => {
    let ok = true;
    if (!recipients) {
      setRecipientsError('Add a CSV or TXT file with at least one email address.');
      ok = false;
    }
    if (chosen.length === 0) {
      setSenderError('Choose at least one sender.');
      ok = false;
    }
    const start = v.sendNow ? Date.now() : fromLocalInputs(v.startDate, v.startTime);
    if (!v.sendNow && (!Number.isFinite(start) || start < Date.now() - 60_000)) {
      setError('startTime', { message: 'Choose a time from now on, or turn on Send now.' });
      ok = false;
    }
    if (!ok || !recipients) return;
    mutation.mutate({
      subject: v.subject,
      body: v.body,
      recipients: recipients.emails,
      startAt: new Date(start).toISOString(),
      delaySeconds: Number(v.delaySeconds),
      hourlyLimit: Number(v.hourlyLimit),
      senderIds:
        senderIds && senders.data && senderIds.length < senders.data.length ? senderIds : undefined,
    });
  });

  const e = formState.errors;
  const bodyLength = values.body?.length ?? 0;
  const count = recipients?.emails.length ?? 0;

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-8 py-5 max-md:px-4 max-md:py-4">
        <div className="min-w-0">
          <Dialog.Title className="text-[26px] leading-8 font-semibold tracking-[-0.02em] text-ink">
            New campaign
          </Dialog.Title>
          <p className="mt-1 text-body-lg text-ink-2">
            Write it once, choose the pace, and check the plan before it starts.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close"
          onClick={requestClose}
          className="-mr-2 size-10"
        >
          <X strokeWidth={1.5} className="size-5!" />
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_380px] md:overflow-hidden">
        {/* Form */}
        <div className="flex flex-col gap-6 px-8 py-7 max-md:px-4 max-md:py-5 md:overflow-y-auto">
          <Step n={1} title="Message">
            <Field id="subject" label="Subject" error={e.subject?.message} required>
              <Input
                id="subject"
                autoFocus
                autoComplete="off"
                maxLength={LIMITS.SUBJECT_MAX}
                placeholder="Quick question about Q4"
                className="h-10 text-body-lg"
                {...describedBy('subject', e.subject?.message)}
                {...register('subject', {
                  validate: (v) => (v.trim() ? true : 'Subject is required'),
                  maxLength: {
                    value: LIMITS.SUBJECT_MAX,
                    message: `Subject must be at most ${LIMITS.SUBJECT_MAX} characters`,
                  },
                })}
              />
            </Field>

            <Field
              id="body"
              label="Message"
              error={e.body?.message}
              helper={
                <span className="tabular">
                  {fmtNumber(bodyLength)} of {fmtNumber(LIMITS.BODY_MAX)} characters. Plain text.
                </span>
              }
              required
            >
              <Textarea
                id="body"
                rows={7}
                className="text-body-lg leading-6"
                {...describedBy('body', e.body?.message, true)}
                {...register('body', {
                  validate: (v) => (v.trim() ? true : 'Message is required'),
                  maxLength: {
                    value: LIMITS.BODY_MAX,
                    message: 'Message must be at most 10,000 characters',
                  },
                })}
              />
            </Field>
          </Step>

          <Step n={2} title="Recipients">
            <RecipientsDropzone
              label="List"
              value={recipients}
              onChange={(v) => (setRecipients(v), setRecipientsError(undefined))}
              error={recipientsError}
            />

            <SenderChips
              senders={senders.data}
              selected={senderIds ?? []}
              onChange={(ids) => (setSenderIds(ids), setSenderError(undefined))}
              loading={senders.isLoading}
              error={senderError}
            />
          </Step>

          <Step n={3} title="Pace">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-label text-ink">Start</legend>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  type="date"
                  aria-label="Start date"
                  className="h-10 w-40"
                  disabled={values.sendNow}
                  {...describedBy('startTime', e.startTime?.message, true)}
                  {...register('startDate')}
                />
                <Input
                  type="time"
                  aria-label="Start time"
                  className="h-10 w-32"
                  disabled={values.sendNow}
                  {...describedBy('startTime', e.startTime?.message, true)}
                  {...register('startTime')}
                />
                <Switch
                  id="sendNow"
                  checked={Boolean(values.sendNow)}
                  onCheckedChange={(v) => form.setValue('sendNow', v, { shouldDirty: true })}
                  label="Send now"
                />
              </div>
              {e.startTime?.message ? (
                <p id="startTime-error" role="alert" className="text-caption text-failed">
                  {e.startTime.message}
                </p>
              ) : (
                <p id="startTime-helper" className="text-caption text-ink-3">
                  {tzLabel()}
                </p>
              )}
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="delaySeconds" label="Delay between emails" error={e.delaySeconds?.message}>
                <NumberInput
                  id="delaySeconds"
                  unit="seconds"
                  min={LIMITS.DELAY_MIN_SECONDS}
                  max={LIMITS.DELAY_MAX_SECONDS}
                  step={1}
                  className="h-10"
                  {...describedBy('delaySeconds', e.delaySeconds?.message)}
                  {...register('delaySeconds', {
                    valueAsNumber: true,
                    validate: (v) =>
                      (Number.isInteger(v) && v >= 1 && v <= LIMITS.DELAY_MAX_SECONDS) ||
                      'Use a whole number from 1 to 3,600',
                  })}
                />
              </Field>
              <Field id="hourlyLimit" label="Hourly limit" error={e.hourlyLimit?.message}>
                <NumberInput
                  id="hourlyLimit"
                  unit="emails per hour"
                  min={LIMITS.HOURLY_MIN}
                  max={LIMITS.HOURLY_MAX}
                  step={1}
                  className="h-10"
                  {...describedBy('hourlyLimit', e.hourlyLimit?.message)}
                  {...register('hourlyLimit', {
                    valueAsNumber: true,
                    validate: (v) =>
                      (Number.isInteger(v) && v >= 1 && v <= LIMITS.HOURLY_MAX) ||
                      'Use a whole number from 1 to 3,600',
                  })}
                />
              </Field>
            </div>
            {intervalMs && (
              <p className="flex items-center gap-2 rounded-control bg-sunken px-3 py-2.5 text-label text-ink-2">
                <Timer aria-hidden strokeWidth={1.5} className="size-4 shrink-0 text-signal" />
                {fmtInterval(intervalMs)}
              </p>
            )}
          </Step>
        </div>

        {/* Preview: sticky beside the form on desktop, a collapsible summary on mobile. */}
        <aside
          aria-label="Preview"
          className="border-line bg-canvas px-6 py-7 max-md:border-t max-md:p-4 md:overflow-y-auto md:border-l"
        >
          <details className="md:hidden" open={false}>
            <summary className="cursor-pointer text-section text-ink">Preview</summary>
            <div className="mt-4">
              <ComposePreview estimate={estimate} />
            </div>
          </details>
          <div className="max-md:hidden">
            <h2 className="text-section text-ink">Preview</h2>
            <p className="mt-1 mb-5 text-label text-ink-3">
              Planned with the same limits the worker enforces.
            </p>
            <ComposePreview estimate={estimate} />
          </div>
        </aside>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-3 border-t border-line px-8 py-4 max-md:px-4 max-md:py-3">
        {confirmDiscard ? (
          <div
            role="alertdialog"
            aria-label="Discard this campaign?"
            className="flex w-full flex-wrap items-center justify-end gap-2"
          >
            <p className="mr-auto text-body-lg text-ink">Discard this campaign?</p>
            <Button
              variant="ghost"
              className="h-10"
              onClick={() => setConfirmDiscard(false)}
              autoFocus
            >
              Keep editing
            </Button>
            <Button variant="destructive" className="h-10" onClick={onClose}>
              Discard
            </Button>
          </div>
        ) : (
          <>
            {estimate?.est.finishAtMs && (
              <p className="mr-auto text-label text-ink-2 max-sm:hidden">
                Finishes around{' '}
                <span className="text-ink tabular">{fmtDayTime(estimate.est.finishAtMs)}</span>
              </p>
            )}
            <Button variant="ghost" className="h-10 px-4 text-body-lg" onClick={requestClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="h-10 px-5 text-body-lg"
              loading={mutation.isPending}
            >
              {count > 0
                ? `Schedule ${fmtNumber(count)} ${count === 1 ? 'email' : 'emails'}`
                : 'Schedule'}
            </Button>
          </>
        )}
      </div>
    </form>
  );
}
