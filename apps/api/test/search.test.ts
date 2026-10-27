import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { campaigns, emails } from '../src/db/schema.js';
import { fragment, highlight, highlightTerms } from '../src/services/search.service.js';
import { resetState, seedSenders, seedUser, testContext } from './helpers.js';

const ctx = testContext();

let alice: string;
let bob: string;

async function campaign(
  userId: string,
  senderId: string,
  subject: string,
  body: string,
  rows: { recipient: string; status?: 'scheduled' | 'sent' | 'failed' }[],
) {
  const [c] = await ctx.db
    .insert(campaigns)
    .values({
      userId,
      subject,
      body,
      startAt: new Date(),
      delayMs: 2000,
      hourlyLimit: 100,
      intervalMs: 36_000,
      totalCount: rows.length,
    })
    .returning();
  const ids: string[] = [];
  for (const [i, r] of rows.entries()) {
    const id = randomUUID();
    ids.push(id);
    await ctx.db.insert(emails).values({
      id,
      campaignId: c!.id,
      userId,
      senderId,
      recipient: r.recipient,
      seq: i,
      status: r.status ?? 'scheduled',
      scheduledAt: new Date(),
      nextAttemptAt: new Date(),
    });
  }
  return ids;
}

const search = (
  userId: string,
  q: string,
  extra: { status?: 'sent'; limit?: number; cursor?: string } = {},
) => ctx.search.search({ userId, q, limit: extra.limit ?? 25, ...extra });

beforeEach(async () => {
  await resetState(ctx);
  alice = (await seedUser(ctx)).id;
  bob = (await seedUser(ctx)).id;
  const [aliceSender] = await seedSenders(ctx, alice, 1);
  const [bobSender] = await seedSenders(ctx, bob, 1);
  await campaign(
    alice,
    aliceSender!.id,
    'Quick question about Q4',
    'Are you free for a pricing call?',
    [{ recipient: 'jane.doe@acme.com', status: 'sent' }, { recipient: 'sam@globex.com' }],
  );
  await campaign(
    alice,
    aliceSender!.id,
    'Proposal follow-up',
    'Attaching the <b>proposal</b> & terms.',
    [{ recipient: 'lee@initech.com' }, { recipient: 'acme@initech.com' }],
  );
  await campaign(bob, bobSender!.id, 'Bob writes to acme too', 'acme acme', [
    { recipient: 'ceo@acme.com' },
  ]);
});
afterAll(async () => {
  await ctx.close();
});

describe('search (Postgres)', () => {
  it('finds part of an address', async () => {
    const r = await search(alice, 'acme');
    expect(r.total).toBe(2);
    expect(r.hits.map((h) => h.highlights.recipient?.[0]).sort()).toEqual([
      '<mark>acme</mark>@initech.com',
      'jane.doe@<mark>acme</mark>.com',
    ]);
  });

  it('ranks recipient matches above subject-only matches', async () => {
    const [sender] = await seedSenders(ctx, alice, 1);
    await campaign(alice, sender!.id, 'Initech renewal', 'Hello', [{ recipient: 'zed@other.com' }]);
    const r = await search(alice, 'initech');
    expect(r.total).toBe(3);
    // The two initech.com recipients come first; the subject-only match is last.
    expect(r.hits.slice(0, 2).every((h) => h.highlights.recipient)).toBe(true);
    expect(r.hits[2]!.highlights.recipient).toBeUndefined();
    expect(r.hits[2]!.highlights.subject).toEqual(['<mark>Initech</mark> renewal']);
  });

  it('finds words in the subject and the message, and a quoted phrase', async () => {
    expect((await search(alice, 'proposal')).total).toBe(2);
    expect((await search(alice, 'pricing')).total).toBe(2);
    expect((await search(alice, '"pricing call"')).total).toBe(2);
    expect((await search(alice, '"call pricing"')).total).toBe(0);
  });

  it("never returns another user's emails", async () => {
    const r = await search(alice, 'acme');
    expect(r.hits.every((h) => !h.highlights.recipient?.[0]?.includes('ceo@'))).toBe(true);
    expect((await search(bob, 'proposal')).total).toBe(0);
  });

  it('filters by status', async () => {
    const r = await search(alice, 'acme', { status: 'sent' });
    expect(r.total).toBe(1);
    expect(r.hits[0]!.highlights.recipient).toEqual(['jane.doe@<mark>acme</mark>.com']);
  });

  it('pages with a cursor and keeps the total', async () => {
    const p1 = await search(alice, 'initech', { limit: 1 });
    expect(p1.total).toBe(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await search(alice, 'initech', { limit: 1, cursor: p1.nextCursor! });
    expect(p2.hits).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect(p2.hits[0]!.id).not.toBe(p1.hits[0]!.id);
  });

  it('treats LIKE wildcards in the text literally', async () => {
    expect((await search(alice, '%')).total).toBe(0);
    expect((await search(alice, '_')).total).toBe(0);
  });

  it('escapes HTML in highlights so message text never becomes markup', async () => {
    const r = await search(alice, 'proposal');
    expect(r.hits[0]!.highlights.body?.[0]).toBe(
      'Attaching the &lt;b&gt;<mark>proposal</mark>&lt;/b&gt; &amp; terms.',
    );
  });
});

describe('highlighting', () => {
  it('ignores quotes and excluded terms, and merges overlapping marks', () => {
    expect(highlightTerms('"Pricing call" -spam OR q4')).toEqual(['pricing', 'call', 'q4']);
    expect(highlight('acmeacme', ['acme', 'meac'])).toBe('<mark>acmeacme</mark>');
    expect(highlight('nothing here', ['acme'])).toBeNull();
  });

  it('cuts long messages to a window around the first match', () => {
    const body = `${'x'.repeat(200)} pricing ${'y'.repeat(200)}`;
    const f = fragment(body, ['pricing'])!;
    expect(f.startsWith('…')).toBe(true);
    expect(f.endsWith('…')).toBe(true);
    expect(f).toContain('<mark>pricing</mark>');
  });
});
