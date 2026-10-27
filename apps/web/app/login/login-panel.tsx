'use client';

import { ArrowLeft, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type CSSProperties } from 'react';
import { Logo } from '@/components/brand/logo';
import { GitHubMark, GoogleG } from '@/components/brand/third-party';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/misc';
import { publicEnv, safeNext } from '@/lib/env';
import { getSupabase } from '@/lib/supabase/client';

const rise = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/**
 * Sign-in (design.md §8.2): a single centered panel on the canvas, floating on the same soft teal
 * glow as the landing hero, with the lockup and a way home above it.
 */
export function LoginPanel() {
  const params = useSearchParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(params.get('error'));
  const next = safeNext(params.get('next'));

  async function signIn() {
    setPending(true);
    setError(null);
    try {
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error: err } = await getSupabase().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          // Also ask to send email, so the account becomes a sender at sign-in (PRD SET-1a).
          scopes: 'https://www.googleapis.com/auth/gmail.send',
          queryParams: { access_type: 'offline', prompt: 'consent' },
        },
      });
      if (err) throw err;
    } catch (err) {
      setError(
        err instanceof Error
          ? `Couldn’t start Google sign-in: ${err.message}`
          : 'Couldn’t start Google sign-in.',
      );
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-canvas">
      <header className="mx-auto flex h-20 w-full max-w-[1280px] items-center justify-between px-8 max-md:px-4">
        <Link href="/" aria-label="Cadence home" className="rounded-control">
          <Logo size="lg" />
        </Link>
        <Button asChild variant="ghost" className="h-10 text-body-lg text-ink-2">
          <Link href="/">
            <ArrowLeft strokeWidth={1.5} aria-hidden /> Back to home
          </Link>
        </Button>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="relative w-full max-w-[440px]">
          {/* The same soft teal glow as the landing hero. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-x-[20%] -inset-y-[24%] blur-3xl"
            style={{
              background:
                'radial-gradient(closest-side, color-mix(in oklab, var(--signal) 40%, transparent), color-mix(in oklab, var(--signal) 18%, transparent) 60%, transparent)',
            }}
          />

          <div
            style={rise(0)}
            className="relative rounded-panel border border-line bg-surface p-10 shadow-float motion-safe:animate-rise max-sm:p-7"
          >
            <h1 className="text-[30px] leading-9 font-semibold tracking-[-0.02em] text-ink">
              Sign in to Cadence
            </h1>
            <p className="mt-2 text-body-lg text-ink-2">
              Schedule campaigns and watch them send at your pace.
            </p>

            {error && <ErrorBanner message={error} className="mt-6" />}

            <Button
              size="lg"
              className="mt-8 h-12 w-full text-body-lg"
              onClick={signIn}
              loading={pending}
            >
              <GoogleG /> Continue with Google
            </Button>

            <p className="mt-6 flex items-start gap-2.5 rounded-control bg-sunken px-3.5 py-3 text-label text-ink-2">
              <ShieldCheck
                strokeWidth={1.5}
                aria-hidden
                className="mt-px size-4 shrink-0 text-signal"
              />
              <span>
                Signing in also lets Cadence send email from this Gmail account. You can disconnect
                it at any time in Settings.
              </span>
            </p>
          </div>

          <p
            style={rise(150)}
            className="relative mt-6 text-center text-caption text-ink-3 motion-safe:animate-rise"
          >
            We use your Google name, email, and photo to sign you in, and send email only for
            campaigns you schedule.{' '}
            <Link href="/privacy" className="underline-offset-4 hover:text-ink hover:underline">
              Privacy policy
            </Link>
          </p>
        </div>
      </main>

      <footer className="mx-auto flex w-full max-w-[1280px] items-center justify-between px-8 py-6 text-label text-ink-3 max-md:px-4">
        <span>Cadence</span>
        <a
          href={publicEnv.githubUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 rounded-control transition-colors hover:text-ink"
        >
          <GitHubMark className="size-3.5" /> GitHub
        </a>
      </footer>
    </div>
  );
}
