import { UpdateSenderSchema } from '@cadence/shared';
import { Router } from 'express';
import { z } from 'zod';
import type { Context } from '../context.js';
import { currentUser } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';

const IdParam = z.object({ id: z.uuid('Not a valid sender ID') });

/** The user's Gmail senders: list, edit, disconnect (tech-spec §5). */
export function sendersRouter(ctx: Context): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json({ items: await ctx.senders.list(currentUser(req).id) });
  });

  router.patch('/:id', async (req, res) => {
    const { id } = parse(IdParam, req.params);
    const input = parse(UpdateSenderSchema, req.body);
    res.json(await ctx.senders.update(currentUser(req).id, id, input));
  });

  router.delete('/:id', async (req, res) => {
    const { id } = parse(IdParam, req.params);
    await ctx.senders.disconnect(currentUser(req).id, id);
    res.status(204).end();
  });

  return router;
}
