/**
 * Formatting rules from design.md §11: Intl everywhere, times in the user's timezone, no "·" chains.
 * Every function takes an optional timezone so tests and server rendering are deterministic.
 */

const nf = new Intl.NumberFormat('en-US');
export const fmtNumber = (n: number) => nf.format(n);

export function plural(n: number, one: string, many = `${one}s`) {
  return `${fmtNumber(n)} ${n === 1 ? one : many}`;
}

const dtf = (opts: Intl.DateTimeFormatOptions, timeZone?: string) =>
  new Intl.DateTimeFormat('en-US', { ...opts, ...(timeZone ? { timeZone } : {}) });

/** "3:40 PM", or "3:40:12 PM" with seconds. */
export function fmtTime(
  at: string | number | Date,
  opts: { seconds?: boolean; timeZone?: string } = {},
) {
  return dtf(
    { hour: 'numeric', minute: '2-digit', ...(opts.seconds ? { second: '2-digit' } : {}) },
    opts.timeZone,
  ).format(new Date(at));
}

/** "Oct 25, 3:40 PM" */
export function fmtDateTime(at: string | number | Date, timeZone?: string) {
  return dtf(
    { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
    timeZone,
  ).format(new Date(at));
}

function dayKey(d: Date, timeZone?: string) {
  return dtf({ year: 'numeric', month: '2-digit', day: '2-digit' }, timeZone).format(d);
}

/** "Today, 6:42 PM", "Tomorrow, 4:04 AM", or "Oct 27, 9:00 AM". */
export function fmtDayTime(
  at: string | number | Date,
  now: number = Date.now(),
  timeZone?: string,
) {
  const d = new Date(at);
  const today = dayKey(new Date(now), timeZone);
  const tomorrow = dayKey(new Date(now + 86_400_000), timeZone);
  const key = dayKey(d, timeZone);
  const time = fmtTime(d, { timeZone });
  if (key === today) return `Today, ${time}`;
  if (key === tomorrow) return `Tomorrow, ${time}`;
  return fmtDateTime(d, timeZone);
}

/** "in 12 min", "2 h ago", "in 3 days". */
export function fmtRelative(at: string | number | Date, now: number = Date.now()) {
  const diff = new Date(at).getTime() - now;
  const abs = Math.abs(diff);
  const future = diff >= 0;
  let text: string;
  if (abs < 45_000) return future ? 'in a few seconds' : 'just now';
  if (abs < 3_600_000) text = `${Math.round(abs / 60_000)} min`;
  else if (abs < 86_400_000) text = `${Math.round(abs / 3_600_000)} h`;
  else {
    const days = Math.round(abs / 86_400_000);
    text = `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return future ? `in ${text}` : `${text} ago`;
}

/** "4 h 8 min", "36 s", "2 days 3 h". */
export function fmtDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h} h ${rm} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d} ${d === 1 ? 'day' : 'days'}${rh ? ` ${rh} h` : ''}`;
}

/** "1 email every 36 seconds" from an interval in ms. */
export function fmtInterval(ms: number) {
  const s = ms / 1000;
  if (s < 60)
    return `1 email every ${Number.isInteger(s) ? s : s.toFixed(1)} ${s === 1 ? 'second' : 'seconds'}`;
  const m = s / 60;
  return `1 email every ${Number.isInteger(m) ? m : m.toFixed(1)} minutes`;
}

/** The user's IANA zone and offset: "Asia/Kolkata, UTC+05:30". */
export function tzLabel(
  now: number = Date.now(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  const parts = dtf({ timeZoneName: 'longOffset' }, timeZone).formatToParts(new Date(now));
  const offset = parts.find((p) => p.type === 'timeZoneName')?.value.replace('GMT', 'UTC') ?? 'UTC';
  return `${timeZone}, ${offset === 'UTC' ? 'UTC+00:00' : offset}`;
}

/** True when the local wall-clock time of `at` falls exactly on the hour. */
function onTheHour(at: Date, timeZone?: string) {
  const parts = dtf(
    { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' },
    timeZone,
  ).formatToParts(at);
  return Number(parts.find((p) => p.type === 'minute')?.value ?? '0') === 0;
}

/** Label for a UTC hour window in local time: "3 PM to 4 PM" (with minutes in half-hour zones). */
export function fmtHourWindow(hourStart: string | number | Date, timeZone?: string) {
  const start = new Date(hourStart);
  const end = new Date(start.getTime() + 3_600_000);
  const opts: Intl.DateTimeFormatOptions = onTheHour(start, timeZone)
    ? { hour: 'numeric' }
    : { hour: 'numeric', minute: '2-digit' };
  return `${dtf(opts, timeZone).format(start)} to ${dtf(opts, timeZone).format(end)}`;
}

/** Short axis label for an hour boundary: "3 PM" (or "3:30 PM"). */
export function fmtAxisHour(at: number, timeZone?: string) {
  const d = new Date(at);
  return dtf(
    onTheHour(d, timeZone) ? { hour: 'numeric' } : { hour: 'numeric', minute: '2-digit' },
    timeZone,
  ).format(d);
}

/** Local date and time input values ("2026-10-25", "15:40") for a timestamp. */
export function toLocalInputs(at: number) {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Parses local date and time input values; returns NaN for incomplete input. */
export function fromLocalInputs(date: string, time: string) {
  if (!date || !time) return Number.NaN;
  return new Date(`${date}T${time}`).getTime();
}
