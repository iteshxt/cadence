import type { EmailStatus } from '@cadence/shared';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';
import { GitHubMark, GoogleG } from '@/components/brand/third-party';
import { StatusMark } from '@/components/emails/status-mark';
import { HeroStrip } from '@/components/landing/hero-strip';
import { LandingHeader } from '@/components/landing/landing-header';
import { PaceVisual, SendVisual, UploadVisual } from '@/components/landing/step-visuals';
import { Button } from '@/components/ui/button';
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

function HeroActions({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Button asChild size="lg">
        <Link href="/login">
          <GoogleG /> Continue with Google
        </Link>
      </Button>
      <Button asChild size="lg" variant="ghost">
        <a href={publicEnv.githubUrl} target="_blank" rel="noreferrer noopener">
          <GitHubMark /> View on GitHub
        </a>
      </Button>
    </div>
  );
}

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
      className={`scroll-mt-16 border-t border-line ${tone === 'canvas' ? 'bg-canvas' : 'bg-surface'}`}
    >
      <div className="mx-auto max-w-[1200px] px-6 py-24 max-md:px-4 max-md:py-16">
        <h2 id={`${id}-title`} className="text-title text-ink">
          {title}
        </h2>
        <p className="mt-2 max-w-[60ch] text-body-lg text-ink-2">{intro}</p>
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-surface">
      <LandingHeader />

      <main>
        <section className="bg-canvas">
          <div className="mx-auto grid max-w-[1200px] grid-cols-1 items-center gap-14 px-6 pt-20 pb-24 max-md:px-4 max-md:pt-12 max-md:pb-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <div className="min-w-0 max-w-xl">
              <h1 className="text-display text-balance text-ink max-sm:text-[34px] max-sm:leading-10">
                Thousands of emails, sent at the pace you set.
              </h1>
              <p className="mt-5 max-w-[56ch] text-body-lg text-ink-2">
                Schedule a campaign, choose how fast it goes, and Cadence sends every email once, on
                time, within every limit.
              </p>
              <HeroActions className="mt-8 flex flex-wrap gap-3" />
              <p className="mt-6 text-caption text-ink-3">
                Free demo. Mail goes to Ethereal, a test inbox, and is never delivered.
              </p>
            </div>
            <HeroStrip />
          </div>
        </section>

        <Section
          id="how"
          title="How a campaign runs"
          intro="Three steps, with a preview before you schedule anything."
        >
          <ol className="grid gap-12 md:grid-cols-3 md:gap-8">
            {steps.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-5">
                {s.visual}
                <div className="flex gap-3">
                  <span
                    aria-hidden
                    className="text-[20px] leading-6 font-semibold tabular text-signal [font-stretch:85%]"
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-section text-ink">{s.title}</h3>
                    <p className="mt-1 max-w-[46ch] text-body-lg text-ink-2">{s.body}</p>
                  </div>
                </div>
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
            {scenarios.map((s) => (
              <div
                key={s.when}
                className="grid gap-x-10 gap-y-2 px-6 py-6 max-md:px-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_160px] md:items-baseline"
              >
                <dt className="text-section text-ink">{s.when}</dt>
                <dd className="max-w-[60ch] text-body-lg text-ink-2">{s.then}</dd>
                <dd className="flex items-center gap-2 md:justify-end">
                  <StatusMark status={s.proof.status} />
                  <span className="text-caption text-ink-3">{s.proof.note}</span>
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        <section className="border-t border-line bg-surface">
          <div className="mx-auto flex max-w-[1200px] flex-col items-start gap-6 px-6 py-20 max-md:px-4 max-md:py-16 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-title text-ink">Schedule your first campaign in a minute.</h2>
              <p className="mt-2 text-body-lg text-ink-2">
                Sign in, upload a list, and watch the strip fill in.
              </p>
            </div>
            <HeroActions className="flex flex-wrap gap-3" />
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-canvas">
        <div className="mx-auto grid max-w-[1200px] gap-8 px-6 py-12 max-md:px-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="flex flex-col gap-3">
            <Logo />
            <p className="max-w-[44ch] text-caption text-ink-3">
              Built with Next.js, Express, BullMQ, Redis, Postgres, and Elasticsearch. Mail goes to
              Ethereal and is never delivered.
            </p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap items-start gap-x-8 gap-y-2 text-body">
            <a href="#how" className="text-ink-2 hover:text-ink">
              How it works
            </a>
            <a href="#reliability" className="text-ink-2 hover:text-ink">
              Reliability
            </a>
            <Link href="/login" className="text-ink-2 hover:text-ink">
              Sign in
            </Link>
            <a
              href={publicEnv.githubUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-ink-2 hover:text-ink"
            >
              GitHub
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
