import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import cors from 'cors';
import { sql } from 'drizzle-orm';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Context } from './context.js';
import { createAuthMiddleware, supabaseVerifier, type VerifyToken } from './middleware/auth.js';
import { basicAuth } from './middleware/basicAuth.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { campaignsRouter } from './routes/campaigns.js';
import { emailsRouter } from './routes/emails.js';
import { gmailRouter } from './routes/gmail.js';
import { miscRouter } from './routes/misc.js';
import { searchRouter } from './routes/search.js';
import { sendersRouter } from './routes/senders.js';
import { settingsRouter } from './routes/settings.js';
import { slackCallbackRouter, slackRouter } from './routes/slack.js';

export interface AppOptions {
  /** Injected in tests; defaults to Supabase JWKS verification. */
  verify?: VerifyToken;
  /** Skip mounting Bull Board (tests). */
  bullBoard?: boolean;
}

export function createApp(ctx: Context, opts: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Caddy

  app.use(
    pinoHttp({
      logger: ctx.log,
      autoLogging: {
        ignore: (req) =>
          req.url === '/health' || req.url?.startsWith('/admin/queues/static') === true,
      },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.get('/health', async (_req, res) => {
    const [db, redis] = await Promise.all([
      ctx.db.execute(sql`select 1`).then(
        () => true,
        () => false,
      ),
      ctx.redis.ping().then(
        (r) => r === 'PONG',
        () => false,
      ),
    ]);
    const status = db && redis ? 'ok' : 'down';
    res.status(status === 'down' ? 503 : 200).json({ status, checks: { db, redis } });
  });

  // Bull Board serves its own inline scripts, so it is mounted before helmet's CSP (QD-1, QD-2).
  if (opts.bullBoard !== false) {
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');
    createBullBoard({
      queues: [new BullMQAdapter(ctx.emailQueue), new BullMQAdapter(ctx.notifyQueue)],
      serverAdapter,
      options: { uiConfig: { boardTitle: 'Cadence queues' } },
    });
    app.use(
      '/admin/queues',
      basicAuth(ctx.env.BULL_BOARD_USER, ctx.env.BULL_BOARD_PASS),
      serverAdapter.getRouter(),
    );
  }

  app.use(helmet());
  app.use(
    cors({
      origin: ctx.env.WEB_URL.replace(/\/+$/, ''),
      allowedHeaders: ['authorization', 'content-type', 'idempotency-key'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // Public: Slack redirects here without a session; the signed state identifies the user.
  app.use('/api/integrations/slack', slackCallbackRouter(ctx));

  const auth = createAuthMiddleware({
    verify: opts.verify ?? supabaseVerifier(ctx.env.SUPABASE_URL),
    db: ctx.db,
  });
  app.use('/api', auth);
  app.use('/api', miscRouter(ctx));
  app.use('/api/campaigns', campaignsRouter(ctx));
  app.use('/api/emails', emailsRouter(ctx));
  app.use('/api/search', searchRouter(ctx));
  app.use('/api/senders', sendersRouter(ctx));
  app.use('/api/settings', settingsRouter(ctx));
  app.use('/api/integrations/gmail', gmailRouter(ctx));
  app.use('/api/integrations/slack', slackRouter(ctx));

  app.use(notFoundHandler);
  app.use(errorHandler(ctx.log));
  return app;
}
