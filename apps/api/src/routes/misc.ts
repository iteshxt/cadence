import { TimelineQuerySchema, type Me } from '@cadence/shared';
import { Router } from 'express';
import type { Context } from '../context.js';
import { currentUser } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';

/** Small read-only routes: /me, /config, /stats, /timeline. */
export function miscRouter(ctx: Context): Router {
  const router = Router();

  router.get('/me', (req, res) => {
    const u = currentUser(req);
    const me: Me = { id: u.id, email: u.email, fullName: u.fullName, avatarUrl: u.avatarUrl };
    res.json(me);
  });

  router.get('/config', (_req, res) => {
    res.json(ctx.config);
  });

  router.get('/stats', async (req, res) => {
    res.json(await ctx.repo.stats(currentUser(req).id));
  });

  router.get('/timeline', async (req, res) => {
    const q = parse(TimelineQuerySchema, req.query);
    res.json(await ctx.timeline.get(currentUser(req).id, q.from, q.to));
  });

  return router;
}
