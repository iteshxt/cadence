import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv, requireSupabaseEnv } from '../env';

/** For Server Components and Route Handlers. */
export async function createSupabaseServer() {
  // Read cookies first: it marks the route as per-request, so pages that use this are never
  // prerendered at build time (where a missing env var would otherwise fail the build).
  const store = await cookies();
  const { url, key } = requireSupabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes
          // the session on every request, so this is safe to ignore.
        }
      },
    },
  });
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

/** Verified claims of the signed-in user (getClaims checks the JWT signature), or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  // Without Supabase settings nobody can be signed in; the login page explains what's missing.
  if (!publicEnv.supabaseUrl || !publicEnv.supabaseKey) {
    await cookies();
    return null;
  }
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return {
    id: claims.sub,
    email: str(claims.email) ?? '',
    name: str(meta.full_name) ?? str(meta.name),
    avatarUrl: str(meta.avatar_url) ?? str(meta.picture),
  };
}
