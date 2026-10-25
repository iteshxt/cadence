/**
 * Creates sender accounts (PRD §10: senders are pre-provisioned).
 *
 *   pnpm --filter api seed:senders            # create 3 new Ethereal accounts
 *   pnpm --filter api seed:senders --count 2
 *   SEED_SENDERS_JSON='[{"user":"x@ethereal.email","pass":"..."}]' pnpm --filter api seed:senders
 *
 * Existing senders (matched by address) are left as they are, so it is safe to run again.
 */
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { parseEnv } from '../src/config/env.js';
import { createDb } from '../src/db/client.js';
import { senders } from '../src/db/schema.js';
import { createCrypto } from '../src/lib/crypto.js';

const { values } = parseArgs({ options: { count: { type: 'string', default: '3' } } });
const env = parseEnv();
const crypto = createCrypto(env.ENCRYPTION_KEY);
const { db, client } = createDb(env.DATABASE_URL, 1);

const Provided = z.array(
  z.object({
    user: z.email(),
    pass: z.string().min(1),
    label: z.string().optional(),
    host: z.string().default('smtp.ethereal.email'),
    port: z.number().int().default(587),
  }),
);

type Account = z.infer<typeof Provided>[number];

const EtherealAccount = z.object({
  status: z.literal('success'),
  user: z.string(),
  pass: z.string(),
  smtp: z.object({ host: z.string(), port: z.number() }),
});

/**
 * nodemailer.createTestAccount() caches one account per process, so call the same Ethereal
 * endpoint directly to get a distinct account for each sender.
 */
async function createEtherealAccount(): Promise<Account> {
  const res = await fetch('https://api.nodemailer.com/user', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requestor: 'cadence', version: '1.0.0' }),
  });
  if (!res.ok) throw new Error(`Ethereal account API returned ${res.status}`);
  const acc = EtherealAccount.parse(await res.json());
  return { user: acc.user, pass: acc.pass, host: acc.smtp.host, port: acc.smtp.port };
}

async function accounts(): Promise<Account[]> {
  if (process.env.SEED_SENDERS_JSON)
    return Provided.parse(JSON.parse(process.env.SEED_SENDERS_JSON));
  const count = Number(values.count);
  const created: Account[] = [];
  for (let i = 0; i < count; i++) created.push(await createEtherealAccount());
  return created;
}

const existing = await db.select({ label: senders.label }).from(senders);
const used = new Set(existing.map((s) => s.label));
const nextLabel = () => {
  for (let i = 0; ; i++) {
    const label = `Sender ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) + 1 : ''}`;
    if (!used.has(label)) {
      used.add(label);
      return label;
    }
  }
};

for (const acc of await accounts()) {
  const label = acc.label ?? nextLabel();
  const [row] = await db
    .insert(senders)
    .values({
      label,
      fromEmail: acc.user,
      smtpHost: acc.host,
      smtpPort: acc.port,
      smtpUser: acc.user,
      smtpPassEnc: crypto.encrypt(acc.pass),
    })
    .onConflictDoNothing({ target: senders.fromEmail })
    .returning({ id: senders.id });
  console.log(row ? `Added ${label} <${acc.user}>` : `Skipped ${acc.user} (already exists)`);
  if (row && !process.env.SEED_SENDERS_JSON) {
    console.log(
      `  Ethereal inbox: https://ethereal.email/login  user ${acc.user}  pass ${acc.pass}`,
    );
  }
}

await client.end();
