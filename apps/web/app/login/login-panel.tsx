'use client';

import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Mark } from '@/components/brand/logo';
import { GoogleG } from '@/components/brand/third-party';
import { Button } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/misc';
import { safeNext } from '@/lib/env';
import { getSupabase } from '@/lib/supabase/client';

/** Centered 400 px panel on the canvas (design.md §8.2). */
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
        options: { redirectTo },
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
    <div className="relative flex min-h-dvh items-center justify-center bg-canvas px-4">
      <Link
        href="/"
        className="absolute top-6 left-6 inline-flex items-center gap-1 rounded-control text-body text-ink-2 hover:text-ink max-md:top-4 max-md:left-4"
      >
        <ChevronLeft strokeWidth={1.5} className="size-4" aria-hidden /> Back
      </Link>
      <div className="w-full max-w-[400px] rounded-panel border border-line bg-surface p-8 max-sm:p-6">
        <Mark className="size-6" />
        <h1 className="mt-6 text-title text-ink">Sign in to Cadence</h1>
        <p className="mt-1 text-body text-ink-2">Use your Google account to continue.</p>
        {error && <ErrorBanner message={error} className="mt-6" />}
        <Button size="lg" className="mt-6 w-full" onClick={signIn} loading={pending}>
          <GoogleG /> Continue with Google
        </Button>
        <p className="mt-6 text-caption text-ink-3">
          By continuing you agree to use Cadence for this demo only. Mail goes to Ethereal, a test
          inbox, and is never delivered.
        </p>
      </div>
    </div>
  );
}
