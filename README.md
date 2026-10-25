# Cadence

A reliable, rate-aware email scheduler with a clean dashboard. Schedule thousands of emails, send them at a safe pace, and never send one twice.

- **Product:** [`docs/prd.md`](docs/prd.md)
- **Architecture and behavior:** [`docs/tech-spec.md`](docs/tech-spec.md)
- **Design system:** [`docs/design.md`](docs/design.md)

```
apps/web        Next.js 16 dashboard (Vercel)
apps/api        Express API + BullMQ worker (one image, two processes)
packages/shared Zod schemas, DTO types, pacing math shared by both
deploy/         Production Docker Compose + Caddy for the free VM
```

## How it works, briefly

- Every email is a row in Postgres (the source of truth) and a **BullMQ delayed job** whose ID is the email ID. There is no cron anywhere.
- A campaign's delay and hourly limit become one spacing, planned when the campaign is created. Each sender's hourly cap is enforced at send time by an atomic Redis Lua script that hands every job its own send slot.
- Overflow is **deferred** to the next UTC hour in order, never dropped, and Slack is told once per sender per hour.
- A conditional update (`scheduled → sending`) is the idempotency guard. Retries only happen when they can't cause a duplicate.
- A reconciler runs once when the API or the worker starts. It re-creates lost jobs and settles interrupted sends.

## Requirements

- Node.js 22.12+ and pnpm 10 (`corepack enable`)
- Docker (Redis, Elasticsearch, and optionally Postgres for local work)
- A Supabase project with the Google provider enabled (for sign-in)

## Run it locally

```bash
pnpm install
docker compose --profile localdb up -d        # Redis, Elasticsearch, and a local Postgres

cp .env.example apps/api/.env                 # then fill in the "api" section
cp .env.example apps/web/.env.local           # then fill in the "web" section

pnpm --filter @cadence/api db:migrate
pnpm --filter @cadence/api seed:senders       # creates 3 Ethereal sender accounts
pnpm dev                                      # web :3000, API :4000 (run the worker too, below)
pnpm --filter @cadence/api dev:worker
```

Without `--profile localdb`, point `DATABASE_URL` at Supabase's **session pooler** connection string.

### Supabase setup

1. Create a project. Under **Authentication → Providers**, enable **Google** with a Google Cloud OAuth client. Its authorized redirect URI is `https://<ref>.supabase.co/auth/v1/callback`.
2. Under **Authentication → URL configuration**, add `http://localhost:3000/auth/callback` and your Vercel URL's `/auth/callback` as redirect URLs.
3. Confirm `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` returns at least one key. If it is empty, the project still uses the legacy JWT secret; migrate it under **Project Settings → JWT Keys** (tech-spec §12).

### Slack setup (optional)

Create a Slack app with the `incoming-webhook` and `chat:write` scopes and the redirect URL `<API URL>/api/integrations/slack/callback`. Then set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_REDIRECT_URI`. Without them, everything else works and the Settings page reports that Slack isn't configured.

## Tests

```bash
pnpm test                                                    # everything
TEST_ELASTICSEARCH_URL=http://localhost:9200 pnpm test       # also run the Elasticsearch suite
```

The API suite starts throwaway Postgres and Redis containers with testcontainers. If your Docker setup can't run the Ryuk reaper, set `TESTCONTAINERS_RYUK_DISABLED=true`. The suite covers:

- Lua reservation under parallel load, and that slots are spaced correctly
- deferral order and Slack-alert deduplication
- idempotent campaign creation, including a double-click race
- the database claim guard
- SMTP retry classification
- lease handling for interrupted sends
- the reconciler
- user scoping

`pnpm typecheck`, `pnpm lint` and `pnpm format:check` run the other checks.

## Acceptance walkthrough (PRD §9)

1. **Sign in** with Google. The header shows your name, email and avatar.
2. **Compose:** upload a CSV. The form shows the count, duplicates and invalid addresses removed. Schedule a couple of minutes ahead, and the emails appear under **Scheduled** and on the pace strip.
3. **Sent:** at their time, rows move to **Sent**. **View in Ethereal** opens the real message.
4. **Restart test:**
   1. Stop the API and worker (`Ctrl+C`, or `docker compose stop api worker`).
   2. Wait past a scheduled time.
   3. Start them again. Overdue emails go out once, right away, and later ones keep their times.
5. **Rate limit:**
   1. Restart the worker with `MAX_EMAILS_PER_HOUR_PER_SENDER=5`.
   2. Schedule 30 emails with **Send now**, a 2 s delay and an hourly limit of 3,600.
   3. Within about a minute, 15 are deferred to the next hour, and a Slack message arrives.
6. **Disconnect Slack** and trigger the limit again: there is no message and no crash. Reconnect, and the next hour's limit alerts again.
7. **Queue dashboard:** `<API URL>/admin/queues` (basic auth) shows delayed, active and completed jobs live.
8. **Search:** press `/` and search by recipient, domain or subject.

To see the 1,000-email behavior from tech-spec §9.5:

```bash
pnpm --filter @cadence/api load-test --user you@example.com --count 1000 --start now --delay 2 --hourly 1000
```

## Deploy (free tier)

See tech-spec §13.2 for why the setup looks like this. In short, free platform hosts block the SMTP port that Ethereal needs.

**Web on Vercel:**

1. Import the repo and set **Root Directory** to `apps/web`.
2. Add the `NEXT_PUBLIC_*` variables. `NEXT_PUBLIC_API_URL` is `https://<your DuckDNS name>`.

**API, worker, Redis and Elasticsearch on an Oracle Cloud Always Free VM:**

1. Create an Ampere A1 instance (Ubuntu). Open ports 80 and 443 in the VCN security list and the OS firewall.
2. Check that SMTP works: `nc -zv smtp.ethereal.email 587`.
3. Install Docker. Raise the Elasticsearch map count:
   ```bash
   sudo sysctl -w vm.max_map_count=262144
   ```
   Persist it in `/etc/sysctl.d/`.
4. Point a free DuckDNS subdomain at the VM's public IP.
5. Write `deploy/.env` from the `api` and `deploy` sections of `.env.example`, then start the stack:
   ```bash
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env run --rm api node dist/scripts/seed-senders.js
   ```
6. Caddy gets a Let's Encrypt certificate automatically. Set `WEB_URL` to the Vercel URL so CORS allows it.

**Fallback (no Oracle account):** run the same compose file on your own machine and expose the API with an ngrok free static domain instead of Caddy.
