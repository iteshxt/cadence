import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';
import {
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  callbackUrl,
  decodeOAuthCookie,
  exchangeCode,
  googleConfig,
} from '@/lib/google-oauth';
import { createSupabaseServer } from '@/lib/supabase/server';

type ConnectResult = 'connected' | 'scope' | 'disconnected' | 'error';

/**
 * Hands Google's refresh token to the API, which stores the sender (tech-spec §7.3). Best effort
 * with a short timeout: sign-in never fails because of it.
 */
async function connectGmail(
  accessToken: string,
  refreshToken: string,
  reconnect: boolean,
): Promise<ConnectResult> {
  try {
    const res = await fetch(`${publicEnv.apiUrl}/api/integrations/gmail/connect`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken, reconnect }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return 'error';
    const body = (await res.json()) as { result?: ConnectResult };
    return body.result ?? 'error';
  } catch {
    return 'error';
  }
}

/** Google's redirect target for sign-in and Connect Gmail (tech-spec §6.1 steps 2–4). */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const saved = decodeOAuthCookie(request.cookies.get(OAUTH_COOKIE)?.value);

  const go = (path: string) => {
    const res = NextResponse.redirect(`${origin}${path}`);
    res.cookies.set(OAUTH_COOKIE, '', { path: OAUTH_COOKIE_PATH, maxAge: 0 });
    return res;
  };
  const loginError = (message: string) => go(`/login?error=${encodeURIComponent(message)}`);
  const settings = (result: string) => go(`/dashboard/settings?gmail=${result}`);

  if (!saved) return loginError('The Google sign-in expired. Try again.');
  const connecting = saved.mode === 'connect';
  const fail = (message: string) => (connecting ? settings('error') : loginError(message));

  const providerError = searchParams.get('error');
  if (providerError) {
    if (connecting) return settings(providerError === 'access_denied' ? 'cancelled' : 'error');
    return loginError(
      providerError === 'access_denied' ? 'Sign-in was cancelled.' : 'Google sign-in failed.',
    );
  }
  const code = searchParams.get('code');
  if (!code || searchParams.get('state') !== saved.state) {
    return fail('The Google sign-in expired. Try again.');
  }

  const config = googleConfig();
  if (!config) return fail('Google sign-in isn’t configured.');
  const tokens = await exchangeCode(code, callbackUrl(origin), config);
  if (!tokens?.id_token) return fail('Google didn’t complete the sign-in. Try again.');

  const supabase = await createSupabaseServer();

  if (connecting) {
    // Adding a Gmail sender must never switch the signed-in user, so no signInWithIdToken here.
    const { data: claims } = await supabase.auth.getClaims();
    const { data } = await supabase.auth.getSession();
    if (!claims?.claims?.sub || !data.session) return go('/login?next=/dashboard/settings');
    if (!tokens.refresh_token) return settings('error');
    const result = await connectGmail(data.session.access_token, tokens.refresh_token, true);
    return settings(result === 'disconnected' ? 'error' : result);
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: tokens.id_token,
    access_token: tokens.access_token,
    nonce: saved.nonce,
  });
  if (error || !data.session) return loginError(error?.message ?? 'Sign-in failed. Try again.');

  // Google returns a refresh token on the first consent; later sign-ins don't need one.
  if (tokens.refresh_token) {
    await connectGmail(data.session.access_token, tokens.refresh_token, false);
  }
  return go(saved.next);
}
