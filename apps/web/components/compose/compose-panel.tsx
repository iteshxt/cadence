'use client';

import {
  LIMITS,
  campaignIntervalMs,
  type CreateCampaignInput,
  type CreateCampaignResponse,
} from '@cadence/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Dialog } from 'radix-ui';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { useConfig, useSenders } from '@/hooks/queries';
import { ApiError, api } from '@/lib/api';
import {
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

/** Opens over any dashboard page when the URL has `?compose=1` (design.md §7.5). */
export function ComposePanel() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const open = params.get('compose') === '1';
  // A new key per opening resets the form and generates a new Idempotency-Key.
  const [session, setSession] = useState(0);

  const close = () => {
    const next = new URLSearchParams(params.toString());
    next.delete('compose');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    setSession((s) => s + 1);
  };

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgb(15_18_17/0.4)] data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
        {open && <ComposeForm key={session} onClose={close} />}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ComposeForm({ onClose }: { onClose: () => void }) {
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
    <Dialog.Content
      onEscapeKeyDown={(ev) => (ev.preventDefault(), requestClose())}
      onPointerDownOutside={(ev) => (ev.preventDefault(), requestClose())}
      onInteractOutside={(ev) => ev.preventDefault()}
      aria-describedby={undefined}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[880px] flex-col bg-surface shadow-float outline-none data-[state=open]:animate-panel-in"
    >
      <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-6 max-md:px-4">
          <Dialog.Title className="text-title text-ink">New campaign</Dialog.Title>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={requestClose}>
            <X strokeWidth={1.5} />
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_380px] md:overflow-hidden">
          {/* Form */}
          <div className="flex flex-col gap-5 p-6 max-md:p-4 md:overflow-y-auto">
            <Field id="subject" label="Subject" error={e.subject?.message} required>
              <Input
                id="subject"
                autoFocus
                autoComplete="off"
                maxLength={LIMITS.SUBJECT_MAX}
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
                rows={8}
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

            <RecipientsDropzone
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

            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-label text-ink">Start</legend>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  type="date"
                  aria-label="Start date"
                  className="w-40"
                  disabled={values.sendNow}
                  {...describedBy('startTime', e.startTime?.message, true)}
                  {...register('startDate')}
                />
                <Input
                  type="time"
                  aria-label="Start time"
                  className="w-32"
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
              <p className="-mt-2 text-caption text-ink-3">{fmtInterval(intervalMs)}</p>
            )}
          </div>

          {/* Preview: sticky beside the form on desktop, a collapsible summary on mobile. */}
          <aside
            aria-label="Preview"
            className="border-line bg-canvas p-6 max-md:border-t max-md:p-4 md:overflow-y-auto md:border-l"
          >
            <details className="md:hidden" open={false}>
              <summary className="cursor-pointer text-label text-ink">Preview</summary>
              <div className="mt-4">
                <ComposePreview estimate={estimate} />
              </div>
            </details>
            <div className="max-md:hidden">
              <h2 className="mb-4 text-label text-ink-2">Preview</h2>
              <ComposePreview estimate={estimate} />
            </div>
          </aside>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-6 py-3 max-md:px-4">
          {confirmDiscard ? (
            <div
              role="alertdialog"
              aria-label="Discard this campaign?"
              className="flex w-full flex-wrap items-center justify-end gap-2"
            >
              <p className="mr-auto text-body text-ink">Discard this campaign?</p>
              <Button variant="ghost" onClick={() => setConfirmDiscard(false)} autoFocus>
                Keep editing
              </Button>
              <Button variant="destructive" onClick={onClose}>
                Discard
              </Button>
            </div>
          ) : (
            <>
              <Button variant="ghost" onClick={requestClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={mutation.isPending}>
                {count > 0
                  ? `Schedule ${fmtNumber(count)} ${count === 1 ? 'email' : 'emails'}`
                  : 'Schedule'}
              </Button>
            </>
          )}
        </div>
      </form>
    </Dialog.Content>
  );
}
