'use client';

import type { ApiErrorBody, ApiErrorCode } from '@cadence/shared';
import { publicEnv } from './env';
import { getSupabase } from './supabase/client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field messages from a VALIDATION_ERROR, keyed by path ("subject", "recipients.0"). */
  get fields(): Record<string, string> {
    const d = this.details as { fields?: Record<string, string> } | undefined;
    return d?.fields ?? {};
  }
}

let redirecting = false;

async function signOutAndRedirect() {
  if (redirecting) return;
  redirecting = true;
  await getSupabase()
    .auth.signOut()
    .catch(() => {});
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Typed fetch to the Express API with the Supabase access token (tech-spec §6.1 step 4). */
export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    await signOutAndRedirect();
    throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue');
  }

  let res: Response;
  try {
    res = await fetch(`${publicEnv.apiUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(
      0,
      'NETWORK',
      'Can’t reach the Cadence API. Check your connection and try again.',
    );
  }

  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as T | ApiErrorBody | null;
  if (res.ok) return body as T;

  const err = (body as ApiErrorBody | null)?.error;
  if (res.status === 401) await signOutAndRedirect();
  throw new ApiError(
    res.status,
    err?.code ?? 'INTERNAL',
    err?.message ?? `Request failed (${res.status})`,
    err?.details,
  );
}
