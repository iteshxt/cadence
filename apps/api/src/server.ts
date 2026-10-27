process.env.CADENCE_SERVICE ??= 'api';

import { createApp } from './app.js';
import { parseEnv } from './config/env.js';
import { createContext } from './context.js';
import { reconcile } from './services/reconciler.service.js';

const env = parseEnv();
const ctx = createContext(env);
const app = createApp(ctx);

const server = app.listen(env.PORT, () => {
  ctx.log.info({ port: env.PORT }, 'api listening');
});

// Boot-time work: it doesn't block serving requests, and doesn't run again until the next boot.
void reconcile({
  redis: ctx.redis,
  emailQueue: ctx.emailQueue,
  repo: ctx.repo,
  log: ctx.log.child({ component: 'reconciler' }),
  leaseMs: env.SEND_LEASE_MS,
}).catch((err) => ctx.log.error({ err }, 'reconciler failed'));

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  ctx.log.info({ signal }, 'shutting down api');
  server.close();
  await ctx.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
