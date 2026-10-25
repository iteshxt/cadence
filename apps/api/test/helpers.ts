import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { inject } from 'vitest';
import { parseEnv, type Env } from '../src/config/env.js';
import { createContext, type Context } from '../src/context.js';
import { profiles, senders } from '../src/db/schema.js';
import { createLogger } from '../src/lib/logger.js';

export function testEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    WEB_URL: 'http://localhost:3000',
    DATABASE_URL: inject('databaseUrl'),
    REDIS_URL: inject('redisUrl'),
    SUPABASE_URL: 'https://example.supabase.co',
    ELASTICSEARCH_URL: 'http://127.0.0.1:1',
    ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    STATE_SECRET: randomBytes(48).toString('base64url'),
    BULL_BOARD_USER: 'admin',
    BULL_BOARD_PASS: 'test-password',
    ...overrides,
  });
}

/** A context whose search writes are recorded instead of sent to Elasticsearch. */
export function testContext(overrides: Partial<Record<keyof Env, string>> = {}) {
  const ctx = createContext(testEnv(overrides), createLogger('silent', false));
  const indexed: string[] = [];
  ctx.search.indexDocs = async (docs) => {
    indexed.push(...docs.map((d) => `${d.id}@${d.version}:${d.status}`));
  };
  ctx.search.ensureIndex = async () => {};
  return Object.assign(ctx, { indexed });
}

export async function resetState(ctx: Context) {
  await ctx.db.execute(
    sql`truncate table rate_limit_events, slack_connections, emails, campaigns, senders, profiles restart identity cascade`,
  );
  await ctx.redis.flushdb();
}

export async function seedUser(
  ctx: Context,
  email = `user-${randomUUID().slice(0, 8)}@example.com`,
) {
  const id = randomUUID();
  await ctx.db.insert(profiles).values({ id, email, fullName: 'Test User' });
  return { id, email };
}

export async function seedSenders(ctx: Context, n = 3) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const [row] = await ctx.db
      .insert(senders)
      .values({
        label: `Sender ${String.fromCharCode(65 + i)}`,
        fromEmail: `sender${i}-${randomUUID().slice(0, 6)}@ethereal.email`,
        smtpUser: `sender${i}@ethereal.email`,
        smtpPassEnc: ctx.crypto.encrypt('secret'),
      })
      .returning();
    rows.push(row!);
  }
  return rows;
}

export const recipients = (n: number, prefix = 'r') =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}@example.com`);

export async function waitFor<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > deadline)
      throw new Error(`waitFor timed out; last value: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
