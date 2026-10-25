import { Router } from 'express';
import { z } from 'zod';
import type { Context } from '../context.js';
import { currentUser } from '../middleware/auth.js';
import { GmailConnectError } from '../services/gmail.service.js';

/** Authenticated Gmail routes, mounted under /api/integrations/gmail. */
export function gmailRouter(ctx: Context): Router {
  const router = Router();
  router.post('/authorize', async (req, res) => {
    res.json({ url: await ctx.gmail.authorizeUrl(currentUser(req).id) });
  });
  return router;
}

const CallbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

/**
 * Google's redirect target. Unauthenticated by design: the signed `state` identifies the user.
 * Always ends with a redirect back to Settings (`?gmail=connected|cancelled|scope|error`).
 */
export function gmailCallbackRouter(ctx: Context): Router {
  const router = Router();
  router.get('/callback', async (req, res) => {
    const settings = new URL('/dashboard/settings', ctx.env.WEB_URL);
    const q = CallbackQuery.safeParse(req.query);
    if (!q.success || q.data.error || !q.data.code || !q.data.state) {
      settings.searchParams.set(
        'gmail',
        q.success && q.data.error === 'access_denied' ? 'cancelled' : 'error',
      );
      res.redirect(303, settings.toString());
      return;
    }
    try {
      await ctx.gmail.completeOAuth(q.data.code, q.data.state);
      settings.searchParams.set('gmail', 'connected');
    } catch (err) {
      ctx.log.warn({ err }, 'gmail callback failed');
      settings.searchParams.set(
        'gmail',
        err instanceof GmailConnectError && err.reason === 'scope' ? 'scope' : 'error',
      );
    }
    res.redirect(303, settings.toString());
  });
  return router;
}
