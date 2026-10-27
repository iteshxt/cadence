import { createHash, randomBytes } from 'node:crypto';

/**
 * Cadence runs Google sign-in and Connect Gmail itself, so Google's screens name Cadence
 * rather than the Supabase project (tech-spec §6.1). Server-only: route handlers import this.
 */

export const OAUTH_COOKIE = 'cadence_google_oauth';
export const OAUTH_COOKIE_PATH = '/auth/google';
export const OAUTH_COOKIE_MAX_AGE = 600;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

/** `signin` creates the Supabase session; `connect` only adds a Gmail sender (Settings). */
export type OAuthMode = 'signin' | 'connect';

export interface OAuthCookie {
  state: string;
  /** The raw nonce: Google gets its SHA-256, Supabase gets this and compares (§6.1). */
  nonce: string;
  next: string;
  mode: OAuthMode;
}

export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function callbackUrl(origin: string): string {
  return `${origin}${OAUTH_COOKIE_PATH}/callback`;
}

export const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

export function newOAuthCookie(mode: OAuthMode, next: string): OAuthCookie {
  return {
    state: randomBytes(24).toString('base64url'),
    nonce: randomBytes(24).toString('base64url'),
    next,
    mode,
  };
}

export const encodeOAuthCookie = (c: OAuthCookie) =>
  Buffer.from(JSON.stringify(c)).toString('base64url');

export function decodeOAuthCookie(raw: string | undefined): OAuthCookie | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<OAuthCookie>;
    if (
      typeof c.state !== 'string' ||
      typeof c.nonce !== 'string' ||
      typeof c.next !== 'string' ||
      (c.mode !== 'signin' && c.mode !== 'connect')
    ) {
      return null;
    }
    return c as OAuthCookie;
  } catch {
    return null;
  }
}

/**
 * Google's consent URL. Sign-in only picks the account (Google returns a refresh token on the
 * first consent anyway); Connect Gmail forces consent so it always gets one.
 */
export function authorizeUrl(opts: { clientId: string; redirectUri: string; cookie: OAuthCookie }) {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', `openid email profile ${SEND_SCOPE}`);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set(
    'prompt',
    opts.cookie.mode === 'connect' ? 'consent select_account' : 'select_account',
  );
  url.searchParams.set('state', opts.cookie.state);
  url.searchParams.set('nonce', sha256Hex(opts.cookie.nonce));
  return url.toString();
}

export interface GoogleTokens {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
  config: { clientId: string; clientSecret: string },
): Promise<GoogleTokens | null> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as GoogleTokens;
    return res.ok ? body : null;
  } catch {
    return null;
  }
}
