'use client';

import { HOUR_MS, estimateFinish, hourIndex, type SenderDto } from '@cadence/shared';
import { useMemo } from 'react';
import { fmtDayTime, fmtDuration, fmtNumber, plural } from '@/lib/format';
import { PaceStrip, type StripPoint, type StripWindow } from '../pace/pace-strip';
import { Readouts } from '../pace/readouts';

export interface PreviewInput {
  count: number;
  startMs: number;
  intervalMs: number;
  senders: SenderDto[];
  maxPerHourPerSender: number;
  minSendGapMs: number;
}

export function useEstimate(input: PreviewInput | null) {
  return useMemo(() => {
    if (
      !input ||
      input.count === 0 ||
      input.senders.length === 0 ||
      !Number.isFinite(input.startMs)
    )
      return null;
    const startHour = hourIndex(input.startMs);
    const est = estimateFinish({
      count: input.count,
      startMs: input.startMs,
      intervalMs: input.intervalMs,
      senderCount: input.senders.length,
      maxPerHourPerSender: input.maxPerHourPerSender,
      minSendGapMs: input.minSendGapMs,
      existingUsage: input.senders.map((s) => ({ [startHour]: s.usedThisHour })),
      collect: true,
    });
    return { est, input };
  }, [input]);
}

export function ComposePreview({ estimate }: { estimate: ReturnType<typeof useEstimate> }) {
  const strip = useMemo(() => {
    if (!estimate) return null;
    const { est, input } = estimate;
    const pad = Math.max(60_000, ((est.finishAtMs ?? 0) - (est.firstAtMs ?? 0)) * 0.04);
    const from = (est.firstAtMs ?? input.startMs) - pad;
    const to = (est.finishAtMs ?? input.startMs) + pad;
    const points: StripPoint[] = est.sends.map((s) => ({
      lane: s.senderIndex,
      t: s.sendAtMs,
      status: s.deferred ? 'deferred' : 'scheduled',
      count: 1,
    }));
    const usage = new Map<string, number>();
    const startHour = hourIndex(input.startMs);
    input.senders.forEach((s, i) => usage.set(`${i}:${startHour}`, s.usedThisHour));
    for (const s of est.sends) {
      const key = `${s.senderIndex}:${hourIndex(s.sendAtMs)}`;
      usage.set(key, (usage.get(key) ?? 0) + 1);
    }
    const windows: StripWindow[] = [...usage.entries()].map(([k, used]) => {
      const [lane, h] = k.split(':').map(Number);
      return { lane: lane!, hourStart: h! * HOUR_MS, used, cap: input.maxPerHourPerSender };
    });
    return { from, to, points, windows };
  }, [estimate]);

  if (!estimate || !strip) {
    return (
      <div className="flex h-full min-h-48 flex-col justify-center rounded-panel border border-dashed border-line p-6 text-center">
        <p className="text-body text-ink-2">Add recipients to see how the campaign will run.</p>
      </div>
    );
  }

  const { est, input } = estimate;
  const perSender = Math.min(est.plannedPerSenderPerHour, input.maxPerHourPerSender);
  const duration = (est.finishAtMs ?? 0) - (est.firstAtMs ?? 0);

  return (
    <div className="flex flex-col gap-5">
      <PaceStrip
        lanes={input.senders.map((s) => ({ id: s.id, label: s.label }))}
        points={strip.points}
        windows={strip.windows}
        from={strip.from}
        to={strip.to}
        summary={`Planned: ${plural(input.count, 'email')} across ${plural(input.senders.length, 'sender')}, from ${fmtDayTime(est.firstAtMs!)} to about ${fmtDayTime(est.finishAtMs!)}.`}
        className="p-3"
      />
      <Readouts
        items={[
          { label: 'First send', value: fmtDayTime(est.firstAtMs!) },
          {
            label: 'Finishes around',
            value: fmtDayTime(est.finishAtMs!),
            hint: duration > 0 ? `About ${fmtDuration(duration)}` : undefined,
          },
          { label: 'Per sender each hour', value: fmtNumber(Math.floor(perSender)) },
          ...(est.deferredCount > 0
            ? [
                {
                  label: 'Moved to a later hour',
                  value: fmtNumber(est.deferredCount),
                  tone: 'deferred' as const,
                },
              ]
            : []),
        ]}
        className="sm:gap-x-8"
      />
      {est.overCapacity && (
        <p className="text-caption text-deferred">
          Your senders can send {fmtNumber(est.capacityPerHour)} emails an hour in total. The rest
          will move to the next hour.
        </p>
      )}
    </div>
  );
}
