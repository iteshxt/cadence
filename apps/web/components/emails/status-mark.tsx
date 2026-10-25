import type { EmailStatus } from '@cadence/shared';
import { cn } from '@/lib/cn';

const LABEL: Record<EmailStatus, string> = {
  scheduled: 'Scheduled',
  sending: 'Sending',
  deferred: 'Deferred',
  sent: 'Sent',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const TONE: Record<EmailStatus, string> = {
  scheduled: 'text-ink-3',
  sending: 'text-signal',
  deferred: 'text-deferred',
  sent: 'text-ink',
  failed: 'text-failed',
  cancelled: 'text-ink-3',
};

/** 10 px glyphs as inline SVG so they render identically everywhere (design.md §3.3). */
function Glyph({ status }: { status: EmailStatus }) {
  const common = {
    width: 10,
    height: 10,
    viewBox: '0 0 10 10',
    'aria-hidden': true as const,
    className: 'shrink-0',
  };
  switch (status) {
    case 'scheduled':
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'sending':
      return (
        <svg {...common} className="shrink-0 animate-pulse-slow">
          <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5 1a4 4 0 0 1 0 8z" fill="currentColor" />
        </svg>
      );
    case 'deferred':
      return (
        <svg {...common}>
          <path
            d="M1.5 7.5V6a3.5 3.5 0 0 1 6.5-1.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M8.8 1.8v2.8H6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'sent':
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="4.25" fill="currentColor" />
        </svg>
      );
    case 'failed':
      return (
        <svg {...common}>
          <path
            d="M2 2l6 6M8 2L2 8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'cancelled':
      return (
        <svg {...common}>
          <path d="M1.5 5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
  }
}

export function StatusMark({ status, className }: { status: EmailStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-label transition-colors duration-150',
        TONE[status],
        className,
      )}
    >
      <Glyph status={status} />
      <span className={cn(status === 'cancelled' && 'line-through')}>{LABEL[status]}</span>
    </span>
  );
}
