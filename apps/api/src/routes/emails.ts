import { EmailsQuerySchema } from '@cadence/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { Context } from '../context.js';
import { AppError, notFound } from '../lib/errors.js';
import { currentUser } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';

const IdParam = z.object({ id: z.uuid('Not a valid email ID') });

export function emailsRouter(ctx: Context): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const user = currentUser(req);
    const q = parse(EmailsQuerySchema, req.query);
    res.json(await ctx.repo.list(user.id, q.view, q.cursor, q.limit));
  });

  router.get('/:id', async (req, res) => {
    const user = currentUser(req);
    const { id } = parse(IdParam, req.params);
    const item = await ctx.repo.getForUser(user.id, id);
    if (!item) throw notFound('Email not found');
    res.json(item);
  });

  router.post('/:id/cancel', async (req, res) => {
    const user = currentUser(req);
    const { id } = parse(IdParam, req.params);
    const row = await ctx.repo.cancel(user.id, id);
    if (!row) {
      const existing = await ctx.repo.getForUser(user.id, id);
      if (!existing) throw notFound('Email not found');
      throw new AppError(
        409,
        'CONFLICT',
        `This email is already ${existing.status} and can’t be cancelled.`,
      );
    }
    // Best effort: the processor also skips cancelled rows, so a job that can't be removed
    // (for example because it's running right now) is harmless.
    await ctx.emailQueue.remove(id).catch(() => 0);
    void ctx.repo.docs([id]).then((d) => ctx.search.indexDocs(d));
    res.json(await ctx.repo.getForUser(user.id, id));
  });

  return router;
}
