import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Local development reads apps/api/.env, falling back to the repo-root .env. In production the
// variables come from the environment (Docker Compose `env_file`), so a missing file is fine.
// Candidates cover both `src/config` (tsx) and `dist/src/config` (compiled) locations.
for (const rel of ['../../.env', '../../../.env', '../../../../.env', '../../../../../.env']) {
  const path = fileURLToPath(new URL(rel, import.meta.url));
  if (existsSync(path)) {
    process.loadEnvFile(path);
    break;
  }
}

const int = (def: number) => z.coerce.number().int().positive().default(def);
/** "true"/"1" or "false"/"0"/empty; anything else is a configuration error. */
const flag = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PORT: int(4000),
  /** Allowed site origins, comma-separated; the first is where OAuth callbacks redirect. */
  WEB_URL: z
    .string()
    .refine(
      (v) => splitOrigins(v).length > 0 && splitOrigins(v).every((o) => URL.canParse(o)),
      'WEB_URL must be one or more URLs, separated by commas',
    ),
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.url(),
  REDIS_URL: z.string().min(1),
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, 'base64').length === 32,
      'ENCRYPTION_KEY must be 32 bytes, base64-encoded',
    ),
  STATE_SECRET: z.string().min(32, 'STATE_SECRET must be at least 32 characters'),
  WORKER_CONCURRENCY: int(5),
  MIN_SEND_GAP_MS: int(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: int(200),
  GLOBAL_LIMITER_MAX: int(10),
  GLOBAL_LIMITER_DURATION_MS: int(1000),
  SEND_LEASE_MS: int(120_000),
  START_GRACE_MS: int(300_000),
  SLACK_CLIENT_ID: optionalString,
  SLACK_CLIENT_SECRET: optionalString,
  SLACK_REDIRECT_URI: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  /** Record sends without calling Gmail (load test, local runs without Google). Never in production. */
  SEND_DRY_RUN: flag,
  /** Run the email and notification workers inside the API process (one service on Render). */
  RUN_WORKER: flag,
  /**
   * Apply database migrations before the API starts serving. Lets a host run one plain
   * `node dist/src/server.js` (no shell wrapper that would swallow SIGTERM).
   */
  MIGRATE_ON_START: flag,
  BULL_BOARD_USER: z.string().min(1),
  BULL_BOARD_PASS: z.string().min(8, 'BULL_BOARD_PASS must be at least 8 characters'),
});

export type Env = z.infer<typeof EnvSchema>;

function splitOrigins(value: string): string[] {
  return value
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/** Every origin the browser may call the API from (CORS). */
export function webOrigins(env: Pick<Env, 'WEB_URL'>): string[] {
  return splitOrigins(env.WEB_URL);
}

/** The site OAuth callbacks send people back to: the first `WEB_URL` entry. */
export function primaryWebUrl(env: Pick<Env, 'WEB_URL'>): string {
  return webOrigins(env)[0]!;
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}

export function slackConfigured(env: Env): boolean {
  return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_REDIRECT_URI);
}
