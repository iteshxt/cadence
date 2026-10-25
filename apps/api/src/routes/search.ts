import { SearchQuerySchema, type SearchPage } from '@cadence/shared';
import { Router } from 'express';
import type { Context } from '../context.js';
import { currentUser } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';

export function searchRouter(ctx: Context): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const user = currentUser(req);
    const q = parse(SearchQuerySchema, req.query);
    const result = await ctx.search.search({
      userId: user.id,
      q: q.q,
      status: q.status,
      cursor: q.cursor,
      limit: q.limit,
    });
    // Elasticsearch finds the matches; Postgres stays the source of truth for what is shown.
    const items = await ctx.repo.getManyForUser(
      user.id,
      result.hits.map((h) => h.id),
    );
    const highlights = new Map(result.hits.map((h) => [h.id, h.highlights]));
    const body: SearchPage = {
      items: items.map((i) => ({ ...i, highlights: highlights.get(i.id) ?? {} })),
      nextCursor: result.nextCursor,
      total: result.total,
    };
    res.json(body);
  });

  return router;
}
