/**
 * Rebuilds the search index from Postgres (SRC-4, tech-spec §11):
 * streams every email into a new index version, swaps the alias atomically, and deletes old versions.
 *
 *   pnpm --filter api reindex
 */
import { asc, gt } from 'drizzle-orm';
import { parseEnv } from '../src/config/env.js';
import { createDb } from '../src/db/client.js';
import { emails } from '../src/db/schema.js';
import { createLogger } from '../src/lib/logger.js';
import { createEmailsRepo } from '../src/services/emails.repo.js';
import {
  INDEX_ALIAS,
  INDEX_MAPPINGS,
  INDEX_SETTINGS,
  createSearch,
  createSearchClient,
} from '../src/services/search.service.js';

const PAGE = 2000;
const env = parseEnv();
const log = createLogger(env.LOG_LEVEL);
const { db, client: sql } = createDb(env.DATABASE_URL, 2);
const es = createSearchClient(env.ELASTICSEARCH_URL, env.ELASTICSEARCH_API_KEY);
const search = createSearch(es, log);
const repo = createEmailsRepo(db);

const target = `${INDEX_ALIAS}-v${Date.now()}`;
await es.indices.create({ index: target, settings: INDEX_SETTINGS, mappings: INDEX_MAPPINGS });

let afterId: string | undefined;
let total = 0;
for (;;) {
  const ids = await db
    .select({ id: emails.id })
    .from(emails)
    .where(afterId ? gt(emails.id, afterId) : undefined)
    .orderBy(asc(emails.id))
    .limit(PAGE);
  if (ids.length === 0) break;
  afterId = ids.at(-1)!.id;
  await search.indexDocs(await repo.docs(ids.map((r) => r.id)), target);
  total += ids.length;
  log.info({ total }, 'indexed');
}
await es.indices.refresh({ index: target });

const current = await es.indices
  .getAlias({ name: INDEX_ALIAS })
  .catch(() => ({}) as Record<string, unknown>);
const old = Object.keys(current);
await es.indices.updateAliases({
  actions: [
    ...old.map((index) => ({ remove: { index, alias: INDEX_ALIAS } })),
    { add: { index: target, alias: INDEX_ALIAS } },
  ],
});
for (const index of old) await es.indices.delete({ index });

log.info({ target, total, removed: old }, 'reindex complete; alias swapped');
await sql.end();
await es.close();
