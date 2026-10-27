import { describe, expect, it } from 'vitest';
import {
  SEND_SCOPE,
  authorizeUrl,
  decodeOAuthCookie,
  encodeOAuthCookie,
  newOAuthCookie,
  sha256Hex,
} from './google-oauth';

describe('google oauth helpers', () => {
  it('round-trips the cookie and rejects anything malformed', () => {
    const c = newOAuthCookie('signin', '/dashboard');
    expect(decodeOAuthCookie(encodeOAuthCookie(c))).toEqual(c);
    expect(decodeOAuthCookie(undefined)).toBeNull();
    expect(decodeOAuthCookie('not-base64-json')).toBeNull();
    expect(
      decodeOAuthCookie(Buffer.from(JSON.stringify({ ...c, mode: 'admin' })).toString('base64url')),
    ).toBeNull();
  });

  it('uses a fresh state and nonce every time', () => {
    const a = newOAuthCookie('signin', '/');
    const b = newOAuthCookie('signin', '/');
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('asks for offline gmail.send and sends Google only the nonce hash', () => {
    const cookie = newOAuthCookie('signin', '/dashboard');
    const url = new URL(
      authorizeUrl({ clientId: 'cid', redirectUri: 'https://x.dev/auth/google/callback', cookie }),
    );
    expect(url.searchParams.get('scope')).toContain(SEND_SCOPE);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.get('state')).toBe(cookie.state);
    expect(url.searchParams.get('nonce')).toBe(sha256Hex(cookie.nonce));
    expect(url.searchParams.get('nonce')).not.toBe(cookie.nonce);
  });

  it('forces consent when connecting another Gmail account', () => {
    const cookie = newOAuthCookie('connect', '/dashboard/settings');
    const url = new URL(authorizeUrl({ clientId: 'cid', redirectUri: 'r', cookie }));
    expect(url.searchParams.get('prompt')).toBe('consent select_account');
  });
});
