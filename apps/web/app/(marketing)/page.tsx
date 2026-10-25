import type { EmailStatus } from '@cadence/shared';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import { GitHubMark, GoogleG } from '@/components/brand/third-party';
import { StatusMark } from '@/components/emails/status-mark';
import { HeroQueue } from '@/components/landing/hero-queue';
import { LandingHeader } from '@/components/landing/landing-header';
import { Reveal, TicksMark } from '@/components/landing/reveal';
import { PaceVisual, SendVisual, UploadVisual } from '@/components/landing/step-visuals';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { publicEnv } from '@/lib/env';

const steps = [
  {
    title: 'Upload recipients',
    body: 'Drop a CSV or TXT file. Duplicates and broken addresses are removed before anything is scheduled.',
    visual: <UploadVisual />,
  },
  {
    title: 'Set the pace',
    body: 'Choose a start time, a delay between emails, and an hourly limit. The preview shows exactly how it will run.',
    visual: <PaceVisual />,
  },
  {
    title: 'Watch it send',
    body: 'Every email goes out at its time, from your sender accounts in turn, within every limit.',
    visual: <SendVisual />,
  },
];

/** Measured or enforced by the system, never aspirational (see the tests and the README). */
const guarantees = [
  { value: '1×', label: 'Each email is sent once, even across restarts' },
  { value: '~50 ms', label: 'From planned time to dispatch, measured locally' },
  { value: '5,000', label: 'Recipients per campaign, checked on upload' },
  { value: '0', label: 'Cron jobs. Every send is a delayed job' },
];

const scenarios: { when: string; then: string; proof: { status: EmailStatus; note: string } }[] = [
  {
    when: 'The server restarts mid-campaign',
    then: 'Emails that came due while it was down send once, right away. The rest keep their times.',
    proof: { status: 'sent', note: '1 attempt' },
  },
  {
    when: 'A sender reaches its hourly cap',
    then: 'Extra emails move to the next hour, in order, and Slack tells you.',
    proof: { status: 'deferred', note: 'to 4:00 PM' },
  },
  {
    when: 'You click Schedule twice',
    then: 'You get one campaign. The second click is recognized and ignored.',
    proof: { status: 'scheduled', note: '1 campaign' },
  },
  {
    when: 'A send fails',
    then: 'It is retried only when a retry can’t cause a duplicate. Otherwise it is marked failed, with the reason.',
    proof: { status: 'failed', note: 'reason shown' },
  },
];

/** Soft fill behind each proof chip, matching the status's own color (design.md §3.2–3.3). */
const PROOF_FILL: Partial<Record<EmailStatus, string>> = {
  deferred: 'bg-deferred-soft',
  failed: 'bg-failed-soft',
  sending: 'bg-signal-soft',
};

/** Staggered entrance for the hero: the page's single load-time sequence (design.md §9). */
const rise = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

function HeroActions({ className, onAccent }: { className?: string; onAccent?: boolean }) {
  return (
    <div className={className}>
      <Button asChild size="lg" className="h-12 px-6 text-body-lg">
        <Link href="/login">
          <GoogleG /> Continue with Google
        </Link>
      </Button>
      <Button
        asChild
        size="lg"
        variant="ghost"
        className={cn(
          'h-12 px-5 text-body-lg',
          onAccent && 'text-signal-fg hover:bg-white/10 active:bg-white/10',
        )}
      >
        <a href={publicEnv.githubUrl} target="_blank" rel="noreferrer noopener">
          <GitHubMark className="size-[18px]" /> View on GitHub
        </a>
      </Button>
    </div>
  );
}

/** A full-viewport section with its content centered vertically. */
function Section({
  id,
  title,
  intro,
  children,
  tone = 'surface',
}: {
  id: string;
  title: string;
  intro: string;
  children: ReactNode;
  tone?: 'surface' | 'canvas';
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={`flex min-h-svh items-center border-t border-line ${tone === 'canvas' ? 'bg-canvas' : 'bg-surface'}`}
    >
      <div className="mx-auto w-full max-w-[1280px] px-8 py-24 max-md:px-4 max-md:py-16">
        <Reveal>
          <h2
            id={`${id}-title`}
            className="text-[40px] leading-[46px] font-semibold tracking-[-0.02em] text-ink max-sm:text-[30px] max-sm:leading-9"
          >
            {title}
          </h2>
          <p className="mt-3 max-w-[60ch] text-[18px] leading-7 text-ink-2">{intro}</p>
        </Reveal>
        <div className="mt-14">{children}</div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="bg-surface">
      <LandingHeader />

      <main>
        {/* Hero: fills the first screen; the guarantees band anchors its bottom edge. */}
        <section className="flex min-h-svh flex-col bg-canvas pt-20">
          <div className="mx-auto grid w-full max-w-[1280px] flex-1 grid-cols-1 content-center items-center gap-16 max-md:gap-12 px-8 py-14 max-md:px-4 max-md:py-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,7fr)]">
            <div className="min-w-0 max-w-[640px]">
              <h1
                style={rise(0)}
                className="text-[60px] leading-[64px] font-semibold tracking-[-0.03em] text-balance text-ink motion-safe:animate-rise max-lg:text-[52px] max-lg:leading-[56px] max-sm:text-[38px] max-sm:leading-[42px]"
              >
                Thousands of emails, sent at the pace you set.
              </h1>
              <p
                style={rise(120)}
                className="mt-6 max-w-[52ch] text-[19px] leading-8 text-ink-2 motion-safe:animate-rise max-sm:text-[17px] max-sm:leading-7"
              >
                Schedule a campaign, choose how fast it goes, and Cadence sends every email once, on
                time, within every limit.
              </p>
              <div style={rise(240)} className="motion-safe:animate-rise">
                <HeroActions className="mt-9 flex flex-wrap gap-3" />
              </div>
              <p style={rise(360)} className="mt-6 text-label text-ink-3 motion-safe:animate-rise">
                Free demo. Mail goes to Ethereal, a test inbox, and is never delivered.
              </p>
            </div>

            {/* The live queue sits on a teal "stage" so the hero carries the brand color. */}
            <div style={rise(300)} className="relative min-w-0 motion-safe:animate-rise">
              <div
                aria-hidden
                className="absolute -inset-4 rounded-[28px] bg-signal-soft sm:-inset-6 lg:-inset-8 lg:translate-x-5 lg:translate-y-5"
              />
              <div className="relative">
                <HeroQueue />
              </div>
            </div>
          </div>

          <div style={rise(600)} className="border-t border-line motion-safe:animate-rise">
            <dl className="mx-auto grid max-w-[1280px] grid-cols-2 px-8 max-md:px-4 lg:grid-cols-4">
              {guarantees.map((g, i) => (
                <div
                  key={g.label}
                  className={cn(
                    'py-7 pr-6 max-lg:py-5',
                    // Soft dividers that fade out at both ends instead of hard rules.
                    'relative before:absolute before:inset-y-3 before:left-0 before:w-px before:bg-linear-to-b before:from-transparent before:via-line before:to-transparent',
                    i === 0 ? 'before:hidden' : 'lg:pl-8',
                    i % 2 === 1 ? 'max-lg:pl-6' : 'max-lg:before:hidden',
                  )}
                >
                  <dt className="sr-only">{g.label}</dt>
                  <dd className="text-[34px] leading-10 font-semibold tabular text-signal [font-stretch:85%]">
                    {g.value}
                  </dd>
                  <dd className="mt-1 text-body text-ink-2">{g.label}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <Section
          id="how"
          title="How a campaign runs"
          intro="Three steps, with a preview before you schedule anything."
        >
          <ol className="grid gap-12 md:grid-cols-3 md:gap-8">
            {steps.map((s, i) => (
              <li key={s.title}>
                <Reveal delay={i * 120} className="flex flex-col gap-6">
                  {s.visual}
                  <div className="flex gap-4">
                    <span
                      aria-hidden
                      className="flex size-9 shrink-0 items-center justify-center rounded-control bg-signal-soft text-[18px] font-semibold tabular text-signal [font-stretch:85%]"
                    >
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="text-[21px] leading-7 font-semibold text-ink">{s.title}</h3>
                      <p className="mt-1.5 max-w-[46ch] text-[17px] leading-7 text-ink-2">
                        {s.body}
                      </p>
                    </div>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          id="reliability"
          tone="canvas"
          title="What happens when…"
          intro="The failure cases are the product. Each one below is covered by an automated test."
        >
          <dl className="divide-y divide-line rounded-panel border border-line bg-surface">
            {scenarios.map((s, i) => (
              <Reveal
                key={s.when}
                delay={i * 90}
                className="grid gap-x-10 gap-y-3 px-8 py-7 max-md:px-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_200px] md:items-center"
              >
                <dt className="text-[20px] leading-7 font-semibold text-ink">{s.when}</dt>
                <dd className="max-w-[60ch] text-[17px] leading-7 text-ink-2">{s.then}</dd>
                <dd className="md:justify-self-end">
                  <span
                    className={cn(
                      'inline-flex items-center gap-2 rounded-full px-3 py-1.5',
                      PROOF_FILL[s.proof.status] ?? 'bg-sunken',
                    )}
                  >
                    <StatusMark status={s.proof.status} />
                    <span className="text-caption text-ink-2">{s.proof.note}</span>
                  </span>
                </dd>
              </Reveal>
            ))}
          </dl>
        </Section>

        {/* The closing call to action and the footer share the last screen. */}
        <div className="flex min-h-svh flex-col">
          <section
            aria-labelledby="start-title"
            className="flex flex-1 items-center bg-signal text-signal-fg"
          >
            <div className="mx-auto flex w-full max-w-[1280px] flex-col items-center px-8 py-24 text-center max-md:px-4 max-md:py-16">
              <TicksMark onAccent />
              <Reveal delay={200} className="mt-10 flex max-w-3xl flex-col items-center gap-6">
                <h2
                  id="start-title"
                  className="text-[56px] leading-[60px] font-semibold tracking-[-0.03em] text-balance max-sm:text-[36px] max-sm:leading-10"
                >
                  Schedule your first campaign in a minute.
                </h2>
                <p className="max-w-[52ch] text-[19px] leading-8 text-signal-fg/80">
                  Sign in, upload a list, and watch the strip fill in. Every email once, on time,
                  within every limit.
                </p>
                <HeroActions onAccent className="mt-2 flex flex-wrap justify-center gap-3" />
              </Reveal>
            </div>
          </section>

          <footer className="bg-canvas">
            <div className="mx-auto grid max-w-[1280px] gap-8 px-8 py-12 max-md:px-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="flex flex-col gap-3">
                <Logo size="lg" />
                <p className="max-w-[48ch] text-body text-ink-3">
                  Built with Next.js, Express, BullMQ, Redis, Postgres, and Elasticsearch. Mail goes
                  to Ethereal and is never delivered.
                </p>
              </div>
              <nav
                aria-label="Footer"
                className="flex flex-wrap items-start gap-x-8 gap-y-2 text-body-lg"
              >
                <a href="#how" className="text-ink-2 transition-colors hover:text-ink">
                  How it works
                </a>
                <a href="#reliability" className="text-ink-2 transition-colors hover:text-ink">
                  Reliability
                </a>
                <Link href="/login" className="text-ink-2 transition-colors hover:text-ink">
                  Sign in
                </Link>
                <a
                  href={publicEnv.githubUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-ink-2 transition-colors hover:text-ink"
                >
                  GitHub
                </a>
              </nav>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}
