# Cadence

Rate-aware email scheduler: Next.js dashboard + Express API + BullMQ worker. Specs live in `docs/`:
`prd.md` (what), `tech-spec.md` (how; the source of truth for behavior), `design.md` (the source of truth for UI).
Read the relevant spec section before changing behavior or UI, and update the spec in the same change when they diverge.

## Layout

- `packages/shared`: Zod schemas, DTO types, constants, and `pacing.ts` (interval, deferral targets, `estimateFinish` simulation). Used by both apps; built to `dist/` (`pnpm --filter @cadence/shared build`).
- `apps/api`: Express (`src/app.ts`, `src/server.ts`) and the worker (`src/worker.ts`). `src/context.ts` wires everything; services in `src/services/`, BullMQ processors in `src/jobs/`, the Lua slot reservation in `src/lua/`.
- `apps/web`: Next.js 16 App Router. `proxy.ts` (Next 16's middleware) guards `/dashboard`. Design tokens in `app/globals.css`; UI primitives in `components/ui/`; the pace strip in `components/pace/`.

## Rules that are easy to break

- No cron or repeatable jobs, ever. Use delayed jobs and boot-time work only (PRD C5).
- Postgres is the source of truth. Every write to `emails` bumps `version` and `updated_at` (search writes depend on it).
- The `scheduled|deferred → sending` conditional update is the idempotency guard. Never send without winning it.
- Only retry SMTP failures that happened before DATA (`classifySmtpError`). Anything ambiguous is marked failed.
- Every query is scoped by `user_id`. Search hits are hydrated from Postgres, scoped to the user.
- UI: color marks exceptions only (deferred, failed, sending). One primary (signal) button per view. No `·` chains, no all-caps labels, no decorative shadows or gradients (design.md §1, §11).

## Commands

```bash
pnpm dev                                   # web + api (start the worker with: pnpm --filter @cadence/api dev:worker)
pnpm test                                  # all tests (API tests need Docker; see README)
pnpm typecheck && pnpm lint && pnpm format:check
docker compose --profile localdb up -d     # Redis, Elasticsearch, local Postgres
```

## Git

Commits are authored by the repo owner only: no `Co-Authored-By` trailers or AI attribution in commit messages or PRs.
