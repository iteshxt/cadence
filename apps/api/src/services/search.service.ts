import { Client, errors, type estypes } from '@elastic/elasticsearch';
import type { EmailStatus } from '@cadence/shared';
import type { Logger } from '../lib/logger.js';
import { AppError } from '../lib/errors.js';

export const INDEX_ALIAS = 'cadence-emails';

/** Splits addresses on punctuation so "acme" finds "jane.doe@acme.com". */
export const INDEX_SETTINGS: estypes.IndicesIndexSettings = {
  analysis: {
    tokenizer: { address_parts: { type: 'pattern', pattern: '[^\\p{L}\\p{N}]+' } },
    analyzer: { address: { type: 'custom', tokenizer: 'address_parts', filter: ['lowercase'] } },
  },
};

export const INDEX_MAPPINGS: estypes.MappingTypeMapping = {
  properties: {
    id: { type: 'keyword' },
    userId: { type: 'keyword' },
    campaignId: { type: 'keyword' },
    status: { type: 'keyword' },
    recipient: { type: 'text', analyzer: 'address', fields: { raw: { type: 'keyword' } } },
    subject: { type: 'text' },
    body: { type: 'text' },
    senderLabel: { type: 'keyword' },
    scheduledAt: { type: 'date' },
    sentAt: { type: 'date' },
  },
};

export interface EmailDoc {
  id: string;
  userId: string;
  campaignId: string;
  status: EmailStatus;
  recipient: string;
  subject: string;
  body: string;
  senderLabel: string;
  scheduledAt: string;
  sentAt: string | null;
  /** emails.version; used as the external version so stale writes are rejected (§11). */
  version: number;
}

export interface SearchParams {
  userId: string;
  q: string;
  status?: EmailStatus;
  cursor?: string;
  limit: number;
}

export interface SearchIdsResult {
  hits: { id: string; highlights: Record<string, string[]> }[];
  nextCursor: string | null;
  total: number;
}

export function createSearchClient(node: string, apiKey?: string): Client {
  return new Client({
    node,
    ...(apiKey ? { auth: { apiKey } } : {}),
    requestTimeout: 5_000,
    maxRetries: 1,
  });
}

/** Elasticsearch errors carry the full request (email bodies included); log only what identifies the failure. */
function briefError(err: unknown) {
  if (err instanceof Error) {
    const status = (err as { meta?: { statusCode?: number } }).meta?.statusCode;
    return { name: err.name, message: err.message, ...(status ? { status } : {}) };
  }
  return { message: String(err) };
}

export function createSearch(client: Client, log: Logger, alias: string = INDEX_ALIAS) {
  return {
    client,

    /** Creates `cadence-emails-v1` behind the alias if no index exists yet. Safe to call at every boot. */
    async ensureIndex(): Promise<void> {
      try {
        if (await client.indices.existsAlias({ name: alias })) return;
        await client.indices.create({
          index: `${alias}-v1`,
          settings: INDEX_SETTINGS,
          mappings: INDEX_MAPPINGS,
          aliases: { [alias]: {} },
        });
        log.info({ index: `${alias}-v1` }, 'search index created');
      } catch (err) {
        if (
          err instanceof errors.ResponseError &&
          err.body?.error?.type === 'resource_already_exists_exception'
        )
          return;
        log.warn(
          { err: briefError(err) },
          'search index not ready; search will be unavailable until Elasticsearch is reachable',
        );
      }
    },

    /**
     * Writes full documents with external versioning. A 409 means Elasticsearch already holds a
     * newer version of that email, which is exactly what we want, so it is ignored. Never throws:
     * indexing failures must not affect sending (§8).
     */
    async indexDocs(docs: EmailDoc[], index = alias): Promise<void> {
      if (docs.length === 0) return;
      try {
        const operations = docs.flatMap(({ version, ...source }) => [
          { index: { _index: index, _id: source.id, version, version_type: 'external' as const } },
          source,
        ]);
        const res = await client.bulk({ operations });
        if (res.errors) {
          const failed = res.items.filter((i) => i.index?.error && i.index.status !== 409);
          if (failed.length > 0) {
            log.warn(
              { failed: failed.length, first: failed[0]?.index?.error },
              'some search documents failed to index',
            );
          }
        }
      } catch (err) {
        log.warn({ err: briefError(err), count: docs.length }, 'search indexing failed');
      }
    },

    async search(p: SearchParams): Promise<SearchIdsResult> {
      const searchAfter = p.cursor ? decodeSearchCursor(p.cursor) : undefined;
      try {
        const res = await client.search<Pick<EmailDoc, 'id'>>({
          index: alias,
          size: p.limit,
          track_total_hits: true,
          _source: ['id'],
          query: {
            bool: {
              filter: [
                { term: { userId: p.userId } },
                ...(p.status ? [{ term: { status: p.status } }] : []),
              ],
              must: [
                {
                  multi_match: {
                    query: p.q,
                    fields: ['recipient^3', 'subject^2', 'body'],
                    type: 'best_fields',
                    operator: 'and',
                    lenient: true,
                  },
                },
              ],
            },
          },
          sort: [{ _score: { order: 'desc' } }, { id: { order: 'asc' } }] satisfies estypes.Sort,
          ...(searchAfter ? { search_after: searchAfter } : {}),
          highlight: {
            pre_tags: ['<mark>'],
            post_tags: ['</mark>'],
            encoder: 'html',
            fields: {
              recipient: {},
              subject: {},
              body: { fragment_size: 120, number_of_fragments: 1 },
            },
          },
        });
        const hits = res.hits.hits;
        const total =
          typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total?.value ?? 0);
        const last = hits.at(-1);
        return {
          hits: hits.map((h) => ({
            id: h._id!,
            highlights: (h.highlight ?? {}) as Record<string, string[]>,
          })),
          nextCursor: hits.length === p.limit && last?.sort ? encodeSearchCursor(last.sort) : null,
          total,
        };
      } catch (err) {
        log.warn({ err: briefError(err) }, 'search query failed');
        throw new AppError(
          503,
          'SEARCH_UNAVAILABLE',
          'Search is unavailable right now. Try again in a moment.',
        );
      }
    },

    async ping(): Promise<boolean> {
      try {
        return await client.ping();
      } catch {
        return false;
      }
    },
  };
}

function encodeSearchCursor(sort: unknown[]): string {
  return Buffer.from(JSON.stringify(sort)).toString('base64url');
}

function decodeSearchCursor(raw: string): unknown[] {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (Array.isArray(v) && v.length === 2) return v;
  } catch {
    // fall through
  }
  throw new AppError(400, 'VALIDATION_ERROR', 'Invalid cursor');
}

export type Search = ReturnType<typeof createSearch>;
