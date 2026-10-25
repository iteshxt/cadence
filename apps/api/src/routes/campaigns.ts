import { CreateCampaignSchema } from '@cadence/shared';
import { count, desc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Context } from '../context.js';
import { campaigns, emails } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { currentUser } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';

const IdempotencyKey = z.string().trim().min(8).max(128).optional();

export function campaignsRouter(ctx: Context): Router {
  const router = Router();

  // 10 campaign creations per minute per user (tech-spec §12).
  const createLimiter = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => currentUser(req).id,
    handler: (_req, _res, next) =>
      next(
        new AppError(
          429,
          'RATE_LIMITED',
          'Too many campaigns in a short time. Wait a minute and try again.',
        ),
      ),
  });

  router.post('/', createLimiter, async (req, res) => {
    const user = currentUser(req);
    const body = parse(CreateCampaignSchema, req.body);
    const key = parse(IdempotencyKey, req.header('idempotency-key') || undefined);
    const result = await ctx.scheduler.create(user.id, body, key);
    if (result.kind === 'duplicate') {
      res.status(409).json({
        error: {
          code: 'DUPLICATE_REQUEST',
          message: 'This campaign was already scheduled.',
          details: result.body,
        },
      });
      return;
    }
    res.status(201).json(result.body);
  });

  router.get('/', async (req, res) => {
    const user = currentUser(req);
    const rows = await ctx.db
      .select({
        id: campaigns.id,
        subject: campaigns.subject,
        startAt: campaigns.startAt,
        totalCount: campaigns.totalCount,
        hourlyLimit: campaigns.hourlyLimit,
        intervalMs: campaigns.intervalMs,
        createdAt: campaigns.createdAt,
        sent: sql<number>`count(*) filter (where ${emails.status} = 'sent')::int`,
        failed: sql<number>`count(*) filter (where ${emails.status} = 'failed')::int`,
        pending: sql<number>`count(*) filter (where ${emails.status} in ('scheduled', 'deferred', 'sending'))::int`,
        total: count(emails.id),
      })
      .from(campaigns)
      .leftJoin(emails, eq(emails.campaignId, campaigns.id))
      .where(eq(campaigns.userId, user.id))
      .groupBy(campaigns.id)
      .orderBy(desc(campaigns.createdAt))
      .limit(50);
    res.json({ items: rows });
  });

  return router;
}
