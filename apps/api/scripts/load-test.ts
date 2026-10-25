/**
 * Schedules a large campaign directly through the scheduler to demonstrate pacing, the hourly
 * caps, and deferral (RL-7, RL-8, tech-spec §9.5). Recipients are generated addresses, so it
 * only runs with SEND_DRY_RUN=true: the worker then records each send without calling Gmail.
 *
 *   pnpm --filter api load-test --user you@example.com --count 1000 --start now
 *   pnpm --filter api load-test --user you@example.com --count 1000 --start 2026-10-25T14:00:00Z \
 *     --delay 2 --hourly 1000
 *
 * The user must have signed in once and connected at least one Gmail sender. Start the worker
 * with SEND_DRY_RUN=true too.
 */
import { parseArgs } from 'node:util';
import { CreateCampaignSchema } from '@cadence/shared';
import { eq } from 'drizzle-orm';
import { parseEnv } from '../src/config/env.js';
import { createContext } from '../src/context.js';
import { profiles } from '../src/db/schema.js';

const { values } = parseArgs({
  options: {
    user: { type: 'string' },
    count: { type: 'string', default: '1000' },
    start: { type: 'string', default: 'now' },
    delay: { type: 'string', default: '2' },
    hourly: { type: 'string', default: '1000' },
  },
});

if (!values.user) {
  console.error('Pass --user <email of a user who has signed in once>');
  process.exit(1);
}

const env = parseEnv();
if (!env.SEND_DRY_RUN) {
  console.error(
    'Refusing to run: set SEND_DRY_RUN=true (here and for the worker). The load test uses\n' +
      'generated recipients, which must never receive real email.',
  );
  process.exit(1);
}
const ctx = createContext(env);
const [profile] = await ctx.db.select().from(profiles).where(eq(profiles.email, values.user));
if (!profile) {
  console.error(`No profile for ${values.user}. Sign in to the dashboard once first.`);
  process.exit(1);
}

const count = Number(values.count);
const startAt =
  values.start === 'now' ? new Date().toISOString() : new Date(values.start).toISOString();
const runId = Date.now().toString(36);
const body = CreateCampaignSchema.parse({
  subject: `Load test ${runId}`,
  body: `Load test message from Cadence (${count} recipients).`,
  recipients: Array.from({ length: count }, (_, i) => `loadtest+${runId}-${i}@example.com`),
  startAt,
  delaySeconds: Number(values.delay),
  hourlyLimit: Number(values.hourly),
});

const t0 = performance.now();
const result = await ctx.scheduler.create(profile.id, body);
const ms = Math.round(performance.now() - t0);

console.log(`Scheduled ${result.body.scheduled} emails in ${ms} ms`);
console.log(`  one email every ${result.body.intervalSeconds} s`);
console.log(`  first send       ${result.body.firstAt}`);
console.log(`  estimated finish ${result.body.estimatedFinishAt}`);
console.log(
  `  per-sender max   ${env.MAX_EMAILS_PER_HOUR_PER_SENDER} per hour (each sender's own limit applies)`,
);
console.log('Watch it in Bull Board (/admin/queues) and on the dashboard.');

await ctx.close();
