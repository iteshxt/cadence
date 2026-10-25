'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseEnv } from '../env';

let client: SupabaseClient | undefined;

/** One browser client per tab; it keeps the session cookie fresh. */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const { url, key } = requireSupabaseEnv();
    client = createBrowserClient(url, key);
  }
  return client;
}
