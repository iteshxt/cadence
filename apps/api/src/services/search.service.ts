import type { EmailStatus } from '@cadence/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { AppError } from '../lib/errors.js';

/** The message fragment shown under a hit: about this many characters around the first match. */
const FRAGMENT_SIZE = 120;

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

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);

/** `%`, `_` and `\` typed by the user match themselves, not "anything". */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** The words to mark: the query's terms, without quotes, parentheses, or excluded (`-word`) terms. */
export function highlightTerms(q: string): string[] {
  const terms = q
    .toLowerCase()
    .replace(/["()]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !t.startsWith('-') && t !== 'or');
  return [...new Set(terms)];
}

/**
 * The text HTML-escaped, with every occurrence of a term wrapped in `<mark>`, or null when nothing
 * matches. Escaping happens around the marks, so user text never reaches the page as markup.
 */
export function highlight(text: string, terms: string[]): string | null {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const term of terms) {
    for (let i = lower.indexOf(term); i !== -1; i = lower.indexOf(term, i + term.length)) {
      ranges.push([i, i + term.length]);
    }
  }
  if (ranges.length === 0) return null;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  let out = '';
  let at = 0;
  for (const [start, end] of merged) {
    out += `${escapeHtml(text.slice(at, start))}<mark>${escapeHtml(text.slice(start, end))}</mark>`;
    at = end;
  }
  return out + escapeHtml(text.slice(at));
}

/** A ~120-character highlighted window around the first match in a long text. */
export function fragment(text: string, terms: string[], size = FRAGMENT_SIZE): string | null {
  const lower = text.toLowerCase();
  const first = Math.min(
    ...terms.map((t) => lower.indexOf(t)).filter((i) => i !== -1),
    Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(first)) return null;
  const start = Math.max(0, first - Math.floor(size / 3));
  const end = Math.min(text.length, start + size);
  const marked = highlight(text.slice(start, end), terms);
  if (!marked) return null;
  return `${start > 0 ? '…' : ''}${marked}${end < text.length ? '…' : ''}`;
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

function decodeCursor(raw: string): number {
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { o?: unknown };
    if (Number.isInteger(v.o) && (v.o as number) >= 0) return v.o as number;
  } catch {
    // fall through
  }
  throw new AppError(400, 'VALIDATION_ERROR', 'Invalid cursor');
}

/**
 * Search over the user's emails in Postgres (tech-spec §11): any part of the recipient (trigram
 * index), the subject, or words of the subject and message (full-text index on the campaign).
 */
export function createSearch(deps: { db: Db }) {
  return {
    async search(p: SearchParams): Promise<SearchIdsResult> {
      const offset = p.cursor ? decodeCursor(p.cursor) : 0;
      const pattern = `%${escapeLike(p.q)}%`;
      const rows = (await deps.db.execute(sql`
        select e.id, e.recipient::text as recipient, c.subject, c.body,
               count(*) over () as total
        from emails e
        join campaigns c on c.id = e.campaign_id
        cross join websearch_to_tsquery('simple', ${p.q}) as query
        where e.user_id = ${p.userId}
          ${p.status ? sql`and e.status = ${p.status}` : sql``}
          and (e.recipient::text ilike ${pattern}
               or c.subject ilike ${pattern}
               or c.search_tsv @@ query)
        order by (lower(e.recipient::text) = lower(${p.q})) desc,
                 (e.recipient::text ilike ${pattern}) desc,
                 ts_rank(c.search_tsv, query) desc,
                 e.id
        limit ${p.limit} offset ${offset}
      `)) as unknown as {
        id: string;
        recipient: string;
        subject: string;
        body: string;
        total: string | number;
      }[];

      const terms = highlightTerms(p.q);
      const total = rows.length > 0 ? Number(rows[0]!.total) : 0;
      return {
        hits: rows.map((r) => {
          const highlights: Record<string, string[]> = {};
          const recipient = highlight(r.recipient, terms);
          const subject = highlight(r.subject, terms);
          const body = fragment(r.body, terms);
          if (recipient) highlights.recipient = [recipient];
          if (subject) highlights.subject = [subject];
          if (body) highlights.body = [body];
          return { id: r.id, highlights };
        }),
        nextCursor: offset + rows.length < total ? encodeCursor(offset + rows.length) : null,
        total,
      };
    },
  };
}

export type Search = ReturnType<typeof createSearch>;
