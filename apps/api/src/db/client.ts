import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export function createDb(url: string, max = 10) {
  // `prepare: false` keeps us compatible with Supabase's pooler in transaction mode as well.
  const client = postgres(url, { max, prepare: false, onnotice: () => {} });
  const db = drizzle(client, { schema });
  return { db, client };
}

export type Db = ReturnType<typeof createDb>['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
