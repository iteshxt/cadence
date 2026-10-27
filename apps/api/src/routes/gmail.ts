import { Router } from 'express';
import { z } from 'zod';
import type { Context } from '../context.js';
import { AppError } from '../lib/errors.js';
import { currentUser } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import { GmailConnectError } from '../services/gmail.service.js';

const ConnectBody = z.object({
  refreshToken: z.string().min(1).max(2048),
  reconnect: z.boolean().optional(),
});

/**
 * Authenticated Gmail routes, mounted under /api/integrations/gmail. The web app runs the Google
 * flow and forwards the refresh token here (tech-spec §6.1, §7.3).
 */
export function gmailRouter(ctx: Context): Router {
  const router = Router();
  router.post('/connect', async (req, res) => {
    const { refreshToken, reconnect } = parse(ConnectBody, req.body);
    try {
      const result = await ctx.gmail.connectWithRefreshToken(currentUser(req).id, refreshToken, {
        reconnect,
      });
      res.json({ result });
    } catch (err) {
      if (err instanceof GmailConnectError) throw new AppError(400, 'GMAIL_ERROR', err.message);
      throw err;
    }
  });
  return router;
}
