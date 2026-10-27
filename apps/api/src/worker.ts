process.env.CADENCE_SERVICE ??= 'worker';

import { parseEnv } from './config/env.js';
import { createContext } from './context.js';
import { reconcile } from './services/reconciler.service.js';
import { startWorkers } from './workers.js';

const env = parseEnv();
const ctx = createContext(env);

try {
  await reconcile({
    redis: ctx.redis,
    emailQueue: ctx.emailQueue,
    repo: ctx.repo,
    log: ctx.log.child({ component: 'reconciler' }),
    leaseMs: env.SEND_LEASE_MS,
  });
} catch (err) {
  ctx.log.error({ err }, 'reconciler failed; starting workers anyway');
}

const workers = startWorkers(ctx);

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  ctx.log.info({ signal }, 'draining worker');
  await workers.close();
  await ctx.close();
  ctx.log.info('worker stopped');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
