import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/lib/logger.js';
import { createSearch, createSearchClient, type EmailDoc } from '../src/services/search.service.js';

/**
 * Runs against a real Elasticsearch when TEST_ELASTICSEARCH_URL is set
 * (e.g. the docker-compose service: TEST_ELASTICSEARCH_URL=http://localhost:9200).
 */
const url = process.env.TEST_ELASTICSEARCH_URL;

describe.skipIf(!url)('search (Elasticsearch)', () => {
  const alias = `cadence-test-${randomUUID().slice(0, 8)}`;
  const client = createSearchClient(url ?? 'http://localhost:9200');
  const search = createSearch(client, createLogger('silent', false), alias);
  const alice = randomUUID();
  const bob = randomUUID();

  const doc = (over: Partial<EmailDoc>): EmailDoc => ({
    id: randomUUID(),
    userId: alice,
    campaignId: randomUUID(),
    status: 'scheduled',
    recipient: 'jane.doe@acme.com',
    subject: 'Quick question about pricing',
    body: 'Hi Jane, do you have a minute next week?',
    senderLabel: 'Sender A',
    scheduledAt: '2026-10-25T10:00:00.000Z',
    sentAt: null,
    version: 1,
    ...over,
  });

  const a = doc({});
  const b = doc({
    recipient: 'sam@globex.io',
    subject: 'Following up',
    body: 'Checking in about the proposal.',
  });
  const c = doc({ recipient: 'max@acme.com', subject: 'Intro', body: 'Nice to meet you.' });
  const other = doc({ userId: bob, recipient: 'jane@acme.com' });

  beforeAll(async () => {
    await search.ensureIndex();
    await search.indexDocs([a, b, c, other]);
    await client.indices.refresh({ index: alias });
  });
  afterAll(async () => {
    await client.indices.delete({ index: `${alias}-v1` }).catch(() => {});
    await client.close();
  });

  it('finds an address by its domain part', async () => {
    const r = await search.search({ userId: alice, q: 'acme', limit: 25 });
    expect(r.hits.map((h) => h.id).sort()).toEqual([a.id, c.id].sort());
    expect(r.hits[0]!.highlights.recipient?.[0]).toContain('<mark>acme</mark>');
  });

  it('searches subject and body', async () => {
    expect(
      (await search.search({ userId: alice, q: 'proposal', limit: 25 })).hits.map((h) => h.id),
    ).toEqual([b.id]);
    expect(
      (await search.search({ userId: alice, q: 'pricing', limit: 25 })).hits.map((h) => h.id),
    ).toEqual([a.id]);
  });

  it("never returns another user's emails", async () => {
    const r = await search.search({ userId: alice, q: 'jane', limit: 25 });
    expect(r.hits.map((h) => h.id)).toEqual([a.id]);
  });

  it('filters by status', async () => {
    expect(
      (await search.search({ userId: alice, q: 'acme', status: 'sent', limit: 25 })).total,
    ).toBe(0);
  });

  it('ignores stale writes so a late bulk index never undoes a newer status', async () => {
    await search.indexDocs([{ ...a, status: 'sent', version: 3 }]);
    await search.indexDocs([{ ...a, status: 'scheduled', version: 1 }]); // the slow initial write arriving late
    await client.indices.refresh({ index: alias });
    const sent = await search.search({ userId: alice, q: 'acme', status: 'sent', limit: 25 });
    expect(sent.hits.map((h) => h.id)).toEqual([a.id]);
  });

  it('pages with search_after', async () => {
    const p1 = await search.search({ userId: alice, q: 'acme', limit: 1 });
    expect(p1.hits).toHaveLength(1);
    expect(p1.total).toBe(2);
    const p2 = await search.search({ userId: alice, q: 'acme', limit: 1, cursor: p1.nextCursor! });
    expect(p2.hits).toHaveLength(1);
    expect(p2.hits[0]!.id).not.toBe(p1.hits[0]!.id);
  });
});
