import { Check, FileText } from 'lucide-react';
import { StatusMark } from '../emails/status-mark';

/** Small, static pieces of the real interface that illustrate each step of a campaign. */

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-hidden
      className="flex h-44 flex-col justify-center gap-3 rounded-panel border border-line bg-surface p-5"
    >
      {children}
    </div>
  );
}

export function UploadVisual() {
  return (
    <Frame>
      <div className="flex h-10 items-center gap-2 rounded-control border border-line px-3">
        <FileText strokeWidth={1.5} className="size-4 text-ink-2" />
        <span className="flex-1 truncate text-body text-ink">q4-leads.csv</span>
        <span className="text-caption text-ink-3">39 KB</span>
      </div>
      <p className="text-body">
        <span className="font-semibold text-ink">1,240 emails ready</span>
        <span className="text-ink-3">. Removed 12 duplicates and 3 invalid addresses.</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {['Sender A', 'Sender B', 'Sender C'].map((s) => (
          <span
            key={s}
            className="inline-flex h-7 items-center gap-1 rounded-control bg-signal-soft px-2.5 text-caption font-medium text-signal"
          >
            <Check strokeWidth={2} className="size-3" /> {s}
          </span>
        ))}
      </div>
    </Frame>
  );
}

function FakeField({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-ink-2">{label}</span>
      <span className="flex h-9 items-center justify-between rounded-control border border-control px-3">
        <span className="tabular text-body text-ink">{value}</span>
        <span className="text-caption text-ink-3">{unit}</span>
      </span>
    </div>
  );
}

export function PaceVisual() {
  return (
    <Frame>
      <div className="grid grid-cols-2 gap-3">
        <FakeField label="Delay between emails" value="2" unit="seconds" />
        <FakeField label="Hourly limit" value="100" unit="per hour" />
      </div>
      <p className="text-caption text-ink-3">1 email every 36 seconds</p>
      <p className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-caption text-ink-2">Finishes around</span>
        <span className="text-[20px] leading-6 font-semibold tabular text-ink [font-stretch:85%]">
          Tomorrow, 4:04 AM
        </span>
      </p>
    </Frame>
  );
}

const rows = [
  { time: '3:40:12 PM', to: 'jane.doe@acme.com', status: 'sent' as const },
  { time: '3:40:48 PM', to: 'sam@globex.io', status: 'sending' as const },
  { time: '3:41:24 PM', to: 'priya@initech.co', status: 'scheduled' as const },
  { time: '4:00:02 PM', to: 'max@example.de', status: 'deferred' as const },
];

export function SendVisual() {
  return (
    <Frame>
      <ul className="-my-1 divide-y divide-line">
        {rows.map((r) => (
          <li key={r.to} className="flex items-center gap-3 py-1.5">
            <span className="w-20 shrink-0 text-label tabular text-ink [font-stretch:85%]">
              {r.time}
            </span>
            <span className="min-w-0 flex-1 truncate text-label text-ink-2">{r.to}</span>
            <StatusMark status={r.status} className="shrink-0" />
          </li>
        ))}
      </ul>
    </Frame>
  );
}
