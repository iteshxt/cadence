process.env.CADENCE_SERVICE ??= 'api';

import { createApp } from './app.js';
import { parseEnv } from './config/env.js';
import { createContext } from './context.js';
import { runMigrations } from './db/migrate.js';
import { reconcile } from './services/reconciler.service.js';
import { startWorkers } from './workers.js';

const env = parseEnv();
if (env.MIGRATE_ON_START) await runMigrations(env.DATABASE_URL);
const ctx = createContext(env);
if (env.MIGRATE_ON_START) ctx.log.info('migrations applied');
const app = createApp(ctx);

const server = app.listen(env.PORT, () => {
  ctx.log.info({ port: env.PORT }, 'api listening');
});

// Boot-time work: it doesn't block serving requests, and doesn't run again until the next boot.
const reconciled = reconcile({
  redis: ctx.redis,
  emailQueue: ctx.emailQueue,
  repo: ctx.repo,
  log: ctx.log.child({ component: 'reconciler' }),
  leaseMs: env.SEND_LEASE_MS,
}).catch((err) => ctx.log.error({ err }, 'reconciler failed'));

// One service on free hosts: the API also runs the workers, after the reconciler (§13.2).
const workers = env.RUN_WORKER ? reconciled.then(() => startWorkers(ctx)) : null;

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  ctx.log.info({ signal }, 'shutting down api');
  server.close();
  if (workers) await (await workers).close();
  await ctx.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
