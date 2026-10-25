import { Router } from 'express';
import { z } from 'zod';
import type { Context } from '../context.js';
import { AppError } from '../lib/errors.js';
import { currentUser } from '../middleware/auth.js';
import { TEST_MESSAGE } from '../services/slack.service.js';

/** Authenticated Slack routes, mounted under /api/integrations/slack. */
export function slackRouter(ctx: Context): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await ctx.slack.status(currentUser(req).id));
  });

  router.post('/authorize', async (req, res) => {
    res.json({ url: await ctx.slack.authorizeUrl(currentUser(req).id) });
  });

  router.delete('/', async (req, res) => {
    await ctx.slack.disconnect(currentUser(req).id);
    res.status(204).end();
  });

  router.post('/test', async (req, res) => {
    const result = await ctx.slack.post(currentUser(req).id, TEST_MESSAGE);
    if (result === 'not-connected')
      throw new AppError(409, 'SLACK_NOT_CONNECTED', 'Connect Slack first.');
    if (result === 'disconnected') {
      throw new AppError(
        409,
        'SLACK_NOT_CONNECTED',
        'Slack no longer accepts messages from Cadence. Connect it again.',
      );
    }
    res.json({ ok: true });
  });

  return router;
}

const CallbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

/**
 * Slack's redirect target. Unauthenticated by design: the signed `state` identifies the user.
 * Always ends with a redirect back to Settings so the browser never lands on raw JSON.
 */
export function slackCallbackRouter(ctx: Context): Router {
  const router = Router();
  router.get('/callback', async (req, res) => {
    const settings = new URL('/dashboard/settings', ctx.env.WEB_URL);
    const q = CallbackQuery.safeParse(req.query);
    if (!q.success || q.data.error || !q.data.code || !q.data.state) {
      settings.searchParams.set(
        'slack',
        q.success && q.data.error === 'access_denied' ? 'cancelled' : 'error',
      );
      res.redirect(303, settings.toString());
      return;
    }
    try {
      await ctx.slack.completeOAuth(q.data.code, q.data.state);
      settings.searchParams.set('slack', 'connected');
    } catch (err) {
      ctx.log.warn({ err }, 'slack callback failed');
      settings.searchParams.set('slack', 'error');
    }
    res.redirect(303, settings.toString());
  });
  return router;
}
