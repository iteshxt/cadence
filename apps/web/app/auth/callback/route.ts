import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv, safeNext } from '@/lib/env';
import { createSupabaseServer } from '@/lib/supabase/server';

/**
 * Hands the Google refresh token from sign-in to the API, which adds the account as a sender
 * (PRD SET-1a). Supabase returns it only in this exchange. Best effort: sign-in never waits long
 * or fails because of it, and the user can still use Connect Gmail in Settings.
 */
async function connectGmail(accessToken: string, refreshToken: string) {
  try {
    await fetch(`${publicEnv.apiUrl}/api/integrations/gmail/sign-in`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // The API is unreachable; Settings still offers Connect Gmail.
  }
}

/** Supabase OAuth code exchange (tech-spec §6.1 step 2). */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));
  const providerError = searchParams.get('error_description') ?? searchParams.get('error');

  if (providerError) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(providerError)}`);
  }
  if (code) {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { session } = data;
      if (session?.provider_refresh_token) {
        await connectGmail(session.access_token, session.provider_refresh_token);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent('Sign-in was not completed.')}`,
  );
}
