import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/brand/logo';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What Cadence collects, why, and how to have it deleted.',
};

const UPDATED = 'October 25, 2026';
const CONTACT = 'petrioteer007@gmail.com';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-section text-ink">{title}</h2>
      <div className="mt-3 flex flex-col gap-3 text-body-lg text-ink-2">{children}</div>
    </section>
  );
}

/** Plain-language privacy policy, required by Google for a published OAuth app. */
export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="mx-auto flex h-20 max-w-[1280px] items-center px-8 max-md:px-4">
        <Link href="/" aria-label="Cadence home" className="rounded-control">
          <Logo size="lg" />
        </Link>
      </header>

      <main className="mx-auto max-w-[720px] px-8 pt-8 pb-24 max-md:px-4">
        <h1 className="text-[36px] leading-[42px] font-semibold tracking-[-0.02em] text-ink">
          Privacy policy
        </h1>
        <p className="mt-3 text-label text-ink-3">Last updated {UPDATED}</p>

        <p className="mt-8 text-body-lg text-ink-2">
          Cadence is a demo email scheduler. This page explains what it stores about you, why, and
          how to have it removed. In short: we keep only what the product needs to work, we never
          sell it, and no email you schedule is delivered to a real inbox.
        </p>

        <Section title="What we collect">
          <p>
            <strong className="text-ink">Your Google profile.</strong> When you sign in with Google
            we receive your name, email address, and profile photo, and nothing else. We use them to
            identify your account and show who is signed in.
          </p>
          <p>
            <strong className="text-ink">What you upload and schedule.</strong> The recipient
            addresses in the files you upload, the subject and message of each campaign, and the
            times and results of each send.
          </p>
          <p>
            <strong className="text-ink">Gmail, if you connect it.</strong> The account&rsquo;s
            address and name, and permission to send email as that account (Google&rsquo;s{' '}
            <code className="text-body">gmail.send</code> scope). Cadence can&rsquo;t read, list, or
            delete anything in your mailbox. Google gives us a token for that permission, which we
            store encrypted.
          </p>
          <p>
            <strong className="text-ink">Slack, if you connect it.</strong> The workspace name,
            channel, and the access token Slack issues, stored encrypted, used only to post a
            message when a sender reaches its hourly limit.
          </p>
        </Section>

        <Section title="How email is handled">
          <p>
            Cadence sends each email from the Gmail account you choose, to the recipients you
            upload, at the times your campaign sets. Sent messages appear in that account&rsquo;s
            Sent folder like any other email. Cadence never sends from an account you haven&rsquo;t
            connected.
          </p>
        </Section>

        <Section title="Google user data">
          <p>
            Cadence&rsquo;s use and transfer of information received from Google APIs adheres to the{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noreferrer noopener"
              className="text-signal underline-offset-4 hover:underline"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
          <p>
            We use your Google data only to sign you in and to send the campaigns you schedule. We
            don&rsquo;t sell it, share it, use it for advertising, or use it to train AI models, and
            nobody reads it unless you ask us to for support, or the law or a security investigation
            requires it.
          </p>
          <p>
            You can remove Cadence&rsquo;s access at any time by disconnecting the account in
            Settings, which also revokes it at Google, or from your{' '}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer noopener"
              className="text-signal underline-offset-4 hover:underline"
            >
              Google Account permissions
            </a>
            .
          </p>
        </Section>

        <Section title="Where it is stored">
          <p>
            Accounts and campaign data are stored in a Supabase Postgres database. A search index
            and a job queue hold copies needed to search and send. Gmail and Slack tokens are
            encrypted at rest. Your data is visible only to your own account.
          </p>
        </Section>

        <Section title="What we don’t do">
          <p>
            We don’t sell or share your data, use it for advertising, or add tracking or analytics
            cookies. The only cookie is the one that keeps you signed in.
          </p>
        </Section>

        <Section title="Deleting your data">
          <p>
            Email{' '}
            <a
              href={`mailto:${CONTACT}`}
              className="text-signal underline-offset-4 hover:underline"
            >
              {CONTACT}
            </a>{' '}
            from the address you signed in with, and we will delete your account and everything
            attached to it. You can also disconnect Gmail and Slack at any time from Settings.
          </p>
        </Section>

        <p className="mt-12 text-body text-ink-3">
          <Link href="/" className="text-signal underline-offset-4 hover:underline">
            Back to Cadence
          </Link>
        </p>
      </main>
    </div>
  );
}
