import { HOUR_MS } from './constants.js';

/** UTC hour window index used by the rate limiter: floor(ms / 1h). */
export function hourIndex(ms: number): number {
  return Math.floor(ms / HOUR_MS);
}

export function hourStartMs(index: number): number {
  return index * HOUR_MS;
}

/**
 * The single spacing between two emails of a campaign. "Delay between emails" and
 * "Hourly limit" are both campaign-wide, so the stricter of the two wins.
 */
export function campaignIntervalMs(delaySeconds: number, hourlyLimit: number): number {
  return Math.max(delaySeconds * 1000, Math.ceil(HOUR_MS / hourlyLimit));
}

/** Planned time of the i-th email (0-based) of a campaign. */
export function plannedAtMs(startMs: number, index: number, intervalMs: number): number {
  return startMs + index * intervalMs;
}

/**
 * Where the N-th email deferred into `nextHour` should go (tech-spec §9.3). Positions beyond
 * what one window can hold spill into later windows directly, in order, instead of being
 * deferred again every hour. `perWindow` is the scope's cap, bounded by how many sends the
 * spacing allows in an hour.
 */
export function deferTargetMs(
  nextHour: number,
  position: number,
  cap: number,
  spacingMs: number,
): number {
  const perWindow = Math.max(1, Math.min(cap, Math.floor(HOUR_MS / Math.max(1, spacingMs))));
  const window = nextHour + Math.floor((position - 1) / perWindow);
  return hourStartMs(window) + ((position - 1) % perWindow) * spacingMs;
}

export type StartResolution = { ok: true; startMs: number } | { ok: false };

/**
 * A start time may be slightly in the past ("Send now", slow requests). Within the grace
 * window it is treated as now; anything older is rejected.
 */
export function resolveStart(startMs: number, nowMs: number, graceMs: number): StartResolution {
  if (startMs >= nowMs) return { ok: true, startMs };
  if (nowMs - startMs <= graceMs) return { ok: true, startMs: nowMs };
  return { ok: false };
}

export interface EstimateInput {
  count: number;
  startMs: number;
  intervalMs: number;
  senderCount: number;
  maxPerHourPerSender: number;
  /**
   * Each sender's own hourly cap, by sender position. When given, it replaces `senderCount` and
   * `maxPerHourPerSender` (senders are users' Gmail accounts, each with its own limit).
   */
  senderCaps?: readonly number[];
  minSendGapMs: number;
  /**
   * Sends already counted against each sender, keyed by sender position and then by hour
   * index. Lets the preview account for other campaigns sharing the same senders.
   */
  existingUsage?: ReadonlyArray<Readonly<Record<number, number>>>;
  /** Collect every simulated send (for drawing the pace strip). Off by default. */
  collect?: boolean;
}

export interface SimulatedSend {
  index: number;
  senderIndex: number;
  plannedAtMs: number;
  sendAtMs: number;
  deferred: boolean;
}

export interface EstimateResult {
  firstAtMs: number | null;
  finishAtMs: number | null;
  deferredCount: number;
  /** Emails per sender per hour the plan asks for, before caps. */
  plannedPerSenderPerHour: number;
  /** Total emails per hour all senders together may send. */
  capacityPerHour: number;
  /** True when the plan asks for more than the senders' hourly caps allow. */
  overCapacity: boolean;
  sends: SimulatedSend[];
}

interface SimEvent {
  at: number;
  index: number;
  deferred: boolean;
}

/** Minimal binary min-heap ordered by (at, index): the order BullMQ promotes delayed jobs. */
class EventQueue {
  private items: SimEvent[] = [];

  get size(): number {
    return this.items.length;
  }

  push(e: SimEvent): void {
    const a = this.items;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(a[i]!, a[p]!)) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }

  pop(): SimEvent | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && before(a[l]!, a[m]!)) m = l;
        if (r < a.length && before(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}

function before(x: SimEvent, y: SimEvent): boolean {
  return x.at < y.at || (x.at === y.at && x.index < y.index);
}

/**
 * Simulates what the worker will do with a campaign, using the same rules, in the same
 * order (by due time): round-robin sender assignment, one send slot per sender at least
 * `minSendGapMs` apart, a fixed UTC hour cap per sender charged to the slot's hour, and
 * deferral of overflow into ordered positions in the next hour (tech-spec §9.2–9.3).
 * Worker concurrency and network latency make real times differ by a few seconds.
 */
export function estimateFinish(input: EstimateInput): EstimateResult {
  const { count, startMs, intervalMs, minSendGapMs: gap } = input;
  const caps =
    input.senderCaps && input.senderCaps.length > 0
      ? input.senderCaps
      : new Array<number>(Math.max(1, input.senderCount)).fill(input.maxPerHourPerSender);
  const senderCount = caps.length;
  const plannedPerSenderPerHour = HOUR_MS / (intervalMs * senderCount);
  const capacityPerHour = caps.reduce((sum, c) => sum + c, 0);
  const result: EstimateResult = {
    firstAtMs: null,
    finishAtMs: null,
    deferredCount: 0,
    plannedPerSenderPerHour,
    capacityPerHour,
    overCapacity: caps.some((c) => plannedPerSenderPerHour > c),
    sends: [],
  };
  if (count <= 0 || caps.some((c) => c <= 0)) return result;

  const nextFree = new Array<number>(senderCount).fill(0);
  const usage = Array.from({ length: senderCount }, (_, s) => {
    const seed = input.existingUsage?.[s];
    return new Map<number, number>(
      seed ? Object.entries(seed).map(([h, n]) => [Number(h), n] as [number, number]) : [],
    );
  });
  const deferPositions = Array.from({ length: senderCount }, () => new Map<number, number>());

  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;

  const queue = new EventQueue();
  for (let i = 0; i < count; i++) {
    queue.push({ at: plannedAtMs(startMs, i, intervalMs), index: i, deferred: false });
  }

  while (queue.size > 0) {
    const ev = queue.pop()!;
    const s = ev.index % senderCount;
    // The worker reserves at processing time `ev.at`; the slot may be later if the sender's
    // previous slot plus the minimum gap hasn't passed yet. The cap is charged to the slot's hour.
    const slot = Math.max(ev.at, nextFree[s]!);
    const hour = hourIndex(slot);
    const used = usage[s]!.get(hour) ?? 0;
    const cap = caps[s]!;
    if (used >= cap) {
      const nextHour = hour + 1;
      const pos = (deferPositions[s]!.get(nextHour) ?? 0) + 1;
      deferPositions[s]!.set(nextHour, pos);
      queue.push({ at: deferTargetMs(nextHour, pos, cap, gap), index: ev.index, deferred: true });
      continue;
    }
    usage[s]!.set(hour, used + 1);
    nextFree[s] = slot + gap;
    if (slot < first) first = slot;
    if (slot > last) last = slot;
    if (ev.deferred) result.deferredCount++;
    if (input.collect) {
      result.sends.push({
        index: ev.index,
        senderIndex: s,
        plannedAtMs: plannedAtMs(startMs, ev.index, intervalMs),
        sendAtMs: slot,
        deferred: ev.deferred,
      });
    }
  }

  if (input.collect) result.sends.sort((a, b) => a.index - b.index);
  result.firstAtMs = first;
  result.finishAtMs = last;
  return result;
}
