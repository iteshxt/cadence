import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Db } from '../db/client.js';
import { profiles } from '../db/schema.js';
import { unauthorized } from '../lib/errors.js';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export type VerifyToken = (token: string) => Promise<JWTPayload>;

/** Verifies Supabase access tokens against the project's JWKS (asymmetric signing keys, tech-spec §12). */
export function supabaseVerifier(supabaseUrl: string): VerifyToken {
  const base = supabaseUrl.replace(/\/+$/, '');
  const jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${base}/auth/v1`,
      audience: 'authenticated',
    });
    return payload;
  };
}

export function userFromClaims(p: JWTPayload): AuthUser | null {
  const meta = (p.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v : null);
  const email = str(p.email) ?? str(meta.email);
  if (!p.sub || !email) return null;
  return {
    id: p.sub,
    email,
    fullName: str(meta.full_name) ?? str(meta.name),
    avatarUrl: str(meta.avatar_url) ?? str(meta.picture),
  };
}

const PROFILE_TTL_MS = 10 * 60_000;

/**
 * Authenticates every /api request and upserts the caller's profile before any handler runs,
 * so foreign keys to `profiles` always resolve (tech-spec §4). A short in-process cache avoids
 * writing on every request.
 */
export function createAuthMiddleware(deps: { verify: VerifyToken; db: Db }) {
  const fresh = new Map<string, { at: number; sig: string }>();

  async function ensureProfile(u: AuthUser) {
    const sig = `${u.email}|${u.fullName}|${u.avatarUrl}`;
    const seen = fresh.get(u.id);
    if (seen && seen.sig === sig && Date.now() - seen.at < PROFILE_TTL_MS) return;
    await deps.db
      .insert(profiles)
      .values({ id: u.id, email: u.email, fullName: u.fullName, avatarUrl: u.avatarUrl })
      .onConflictDoUpdate({
        target: profiles.id,
        set: {
          email: u.email,
          fullName: u.fullName,
          avatarUrl: u.avatarUrl,
          updatedAt: new Date(),
        },
      });
    fresh.set(u.id, { at: Date.now(), sig });
  }

  return async function auth(req: Request, _res: Response, next: NextFunction) {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) return next(unauthorized());
    let user: AuthUser | null;
    try {
      user = userFromClaims(await deps.verify(token));
    } catch {
      return next(unauthorized('Your session has expired. Sign in again.'));
    }
    if (!user) return next(unauthorized());
    await ensureProfile(user);
    req.user = user;
    next();
  };
}

/** For handlers mounted behind the auth middleware. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
