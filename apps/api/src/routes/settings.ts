import { UserSettingsSchema } from '@cadence/shared';
import { Router } from 'express';
import type { Context } from '../context.js';
import { currentUser } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';

/** The user's Compose defaults (PRD SET-6). */
export function settingsRouter(ctx: Context): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await ctx.settings.get(currentUser(req).id));
  });

  router.put('/', async (req, res) => {
    const input = parse(UserSettingsSchema, req.body);
    res.json(await ctx.settings.save(currentUser(req).id, input));
  });

  return router;
}
