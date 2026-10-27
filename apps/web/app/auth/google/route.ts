import { NextResponse, type NextRequest } from 'next/server';
import {
  OAUTH_COOKIE,
  OAUTH_COOKIE_MAX_AGE,
  OAUTH_COOKIE_PATH,
  authorizeUrl,
  callbackUrl,
  encodeOAuthCookie,
  googleConfig,
  newOAuthCookie,
} from '@/lib/google-oauth';
import { safeNext } from '@/lib/env';

/**
 * Starts Google sign-in (`?next=`) or Connect Gmail (`?mode=connect`), tech-spec §6.1 step 1.
 * The state and nonce go into a short-lived httpOnly cookie that only the callback reads.
 */
export function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const mode = searchParams.get('mode') === 'connect' ? 'connect' : 'signin';
  const config = googleConfig();
  if (!config) {
    const message =
      'Google sign-in isn’t configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.';
    return NextResponse.redirect(
      mode === 'connect'
        ? `${origin}/dashboard/settings?gmail=error`
        : `${origin}/login?error=${encodeURIComponent(message)}`,
    );
  }

  const next = mode === 'connect' ? '/dashboard/settings' : safeNext(searchParams.get('next'));
  const cookie = newOAuthCookie(mode, next);
  const res = NextResponse.redirect(
    authorizeUrl({ clientId: config.clientId, redirectUri: callbackUrl(origin), cookie }),
  );
  res.cookies.set(OAUTH_COOKIE, encodeOAuthCookie(cookie), {
    httpOnly: true,
    sameSite: 'lax',
    secure: origin.startsWith('https://'),
    path: OAUTH_COOKIE_PATH,
    maxAge: OAUTH_COOKIE_MAX_AGE,
  });
  return res;
}
