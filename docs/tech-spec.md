# Cadence — Technical Specification

| | |
|---|---|
| **Status** | Draft v1 |
| **Companion docs** | [`prd.md`](./prd.md) · [`design.md`](./design.md) |

---

## 1. Architecture overview

```
                    ┌──────────────────────────────┐
                    │        Next.js (apps/web)     │
   Browser ───────▶ │  Landing · Login · Dashboard  │
                    │  Supabase Auth (Google OAuth) │
                    └──────────────┬───────────────┘
                                   │ HTTPS + Bearer <Supabase JWT>
                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Express API (apps/api)                        │
│  /api/campaigns  /api/emails  /api/search  /api/integrations/slack│
│  /admin/queues (Bull Board, basic auth)      /health              │
└───────┬───────────────────┬───────────────────┬──────────────────┘
        │ Drizzle ORM       │ BullMQ add/addBulk│ index/search
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────────┐   ┌───────────────┐
│  Supabase    │   │      Redis       │   │ Elasticsearch │
│  Postgres    │   │ queues + limiter │   │  emails index │
│ (source of   │   │ counters (AOF on)│   └───────▲───────┘
│  truth)      │   └────────┬─────────┘           │
└──────▲───────┘            │ jobs                │
       │                    ▼                     │
       │        ┌─────────────────────────┐       │
       └────────│  Worker (apps/api,      │───────┘
                │  entry: worker.ts)      │
                │  email-send queue       │──▶ Ethereal SMTP (N senders)
                │  notifications queue    │──▶ Slack Incoming Webhook
                └─────────────────────────┘
```

**Key principle:** **Postgres is the source of truth.** Redis holds the *schedule* (delayed jobs) and the *limiter state*. Elasticsearch is a *derived read model*. Any Redis or Elasticsearch state can be rebuilt from Postgres.

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Monorepo | **pnpm workspaces** + **Turborepo** | Shared types and schemas, one install, parallel dev |
| Frontend | **Next.js** (latest stable, App Router, React Server Components) + **TypeScript** | Server-side auth guards and fast page loads |
| Styling | **Tailwind CSS v4** + **shadcn/ui** (Radix primitives) | Accessible primitives that we fully own |
| Data fetching | **TanStack Query** | Caching, polling, and loading/error states |
| Forms | **react-hook-form** + **Zod** (shared schemas) | One validation source for front and back end |
| CSV | **Papa Parse** | Streaming, robust CSV parsing |
| Toasts | **sonner** | Minimal and accessible |
| Icons | **lucide-react** | Consistent 1.5px stroke |
| Auth | **Supabase Auth** (Google provider) + `@supabase/ssr` | Real OAuth with almost no custom code |
| Backend | **Express** + **TypeScript** (Node 22 LTS) | Minimal, mature HTTP framework |
| ORM | **Drizzle ORM** + drizzle-kit migrations | Type-safe SQL, lightweight, works well with Supabase |
| Database | **Supabase Postgres** | Relational data with managed hosting and auth in one place |
| Queue | **BullMQ** + **ioredis** | Delayed jobs, retries, stalled-job recovery |
| Queue UI | **@bull-board/express** | Live dashboard |
| SMTP | **Nodemailer** → **Ethereal** | Fake SMTP for safe testing, with preview URLs |
| Search | **Elasticsearch 8** + `@elastic/elasticsearch` | Full-text search over email history |
| JWT verification | **jose** (JWKS) | Verifies Supabase tokens without a network call per request |
| Logging | **pino** + pino-http | Structured JSON logs |
| Testing | **Vitest** + **Supertest** + **testcontainers** (Redis) | Unit and integration tests |
| Local infrastructure | **Docker Compose** (Redis 7, Elasticsearch 8) | One command to start |

## 3. Repository layout

```
cadence/
├─ apps/
│  ├─ web/                       # Next.js
│  │  ├─ app/
│  │  │  ├─ (marketing)/page.tsx           # /
│  │  │  ├─ login/page.tsx                 # /login
│  │  │  ├─ auth/callback/route.ts         # OAuth code exchange
│  │  │  ├─ dashboard/
│  │  │  │  ├─ layout.tsx                  # header, tabs, auth guard
│  │  │  │  ├─ page.tsx                    # redirect → scheduled
│  │  │  │  ├─ scheduled/page.tsx
│  │  │  │  ├─ sent/page.tsx
│  │  │  │  ├─ search/page.tsx
│  │  │  │  └─ settings/page.tsx
│  │  │  └─ not-found.tsx
│  │  ├─ components/
│  │  │  ├─ ui/                  # Button, Input, Table, Badge, Dialog… (shadcn)
│  │  │  ├─ layout/              # AppHeader, UserMenu, DashboardTabs
│  │  │  ├─ emails/              # EmailTable, StatusBadge, EmptyState
│  │  │  ├─ compose/             # ComposeDialog, LeadsDropzone, PacingFields
│  │  │  └─ settings/            # SlackCard, SendersCard
│  │  ├─ lib/
│  │  │  ├─ supabase/{client,server,middleware}.ts
│  │  │  ├─ api.ts               # typed fetch wrapper (adds Bearer token)
│  │  │  ├─ csv.ts               # parse + dedupe + validate leads
│  │  │  └─ format.ts            # dates, numbers
│  │  ├─ hooks/                  # useEmails, useStats, useSlackStatus…
│  │  └─ middleware.ts           # refresh session, protect /dashboard
│  └─ api/                       # Express + worker
│     ├─ src/
│     │  ├─ server.ts            # HTTP entry
│     │  ├─ worker.ts            # Worker entry
│     │  ├─ config/env.ts        # Zod-validated env
│     │  ├─ db/{schema.ts,client.ts,migrations/}
│     │  ├─ middleware/{auth.ts,error.ts,validate.ts}
│     │  ├─ routes/{campaigns,emails,search,senders,stats,slack}.ts
│     │  ├─ services/
│     │  │  ├─ scheduler.service.ts    # create campaign → rows → jobs
│     │  │  ├─ mailer.service.ts       # nodemailer transports per sender
│     │  │  ├─ ratelimit.service.ts    # Lua scripts
│     │  │  ├─ search.service.ts       # ES index/query
│     │  │  ├─ slack.service.ts        # OAuth + notify
│     │  │  └─ reconciler.service.ts   # boot-time repair
│     │  ├─ queues/{connection,emailQueue,notifyQueue}.ts
│     │  ├─ jobs/{sendEmail.processor,notify.processor}.ts
│     │  ├─ lua/{reserve_send.lua}
│     │  └─ lib/{crypto,logger,time}.ts
│     ├─ scripts/{seed-senders.ts,reindex.ts,load-test.ts}
│     └─ test/
├─ packages/
│  └─ shared/                    # Zod schemas, DTO types, enums
│     └─ src/{schemas.ts,types.ts,constants.ts}
├─ docker-compose.yml
├─ turbo.json · pnpm-workspace.yaml · .env.example
├─ prd.md · tech-spec.md · design.md · README.md
```

## 4. Data model (Postgres / Drizzle)

Supabase owns `auth.users`. We mirror the profile fields we need into `public.profiles`, using a trigger on signup or an upsert on the first API call.

```sql
-- enums
create type email_status as enum
  ('scheduled','deferred','sending','sent','failed','cancelled');

create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

create table senders (                    -- Ethereal accounts
  id           uuid primary key default gen_random_uuid(),
  label        text not null,             -- "Sender A"
  from_email   text not null unique,
  smtp_host    text not null default 'smtp.ethereal.email',
  smtp_port    int  not null default 587,
  smtp_user    text not null,
  smtp_pass_enc text not null,            -- AES-256-GCM
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table campaigns (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  subject         text not null,
  body            text not null,
  start_at        timestamptz not null,
  delay_ms        int  not null check (delay_ms >= 1000),
  hourly_limit    int  not null check (hourly_limit > 0),
  total_count     int  not null,
  idempotency_key text,                   -- from client header
  created_at      timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table emails (
  id              uuid primary key default gen_random_uuid(),  -- == BullMQ jobId
  campaign_id     uuid not null references campaigns(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  sender_id       uuid not null references senders(id),
  recipient       citext not null,
  seq             int  not null,          -- order within campaign
  status          email_status not null default 'scheduled',
  scheduled_at    timestamptz not null,   -- original plan
  next_attempt_at timestamptz not null,   -- current plan (moves on defer)
  sent_at         timestamptz,
  attempts        int not null default 0,
  claimed_at      timestamptz,            -- set when status → sending
  message_id      text,
  preview_url     text,
  error           text,
  defer_reason    text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (campaign_id, recipient)         -- no duplicate recipient per campaign
);
create index emails_user_status_next on emails (user_id, status, next_attempt_at);
create index emails_user_sent        on emails (user_id, sent_at desc) where status in ('sent','failed');

create table slack_connections (
  user_id         uuid primary key references profiles(id) on delete cascade,
  team_id         text not null,
  team_name       text not null,
  channel_name    text not null,
  webhook_url_enc text not null,          -- AES-256-GCM
  access_token_enc text not null,
  connected_at    timestamptz not null default now()
);

create table rate_limit_events (          -- audit trail
  id          bigserial primary key,
  user_id     uuid not null,
  sender_id   uuid not null,
  window_key  text not null,              -- '2026102514'
  scope       text not null,              -- 'sender' | 'campaign'
  notified    boolean not null default false,
  created_at  timestamptz not null default now()
);
```

**Status lifecycle**

```
scheduled ──(eligible, claimed)──▶ sending ──▶ sent
    │  ▲                             │  └────▶ failed (after retries / interrupted)
    │  └──(limit hit)── deferred ◀───┘ (only before claim)
    └──(user)──▶ cancelled
```

## 5. API specification (Express)

The base URL is `/api`. Every route except health, the Slack callback, and Bull Board requires `Authorization: Bearer <supabase_access_token>`. Responses are JSON. Errors use the shape `{ error: { code, message, details? } }`.

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness, plus Redis, database, and Elasticsearch checks |
| GET | `/api/me` | Profile, upserted on first call |
| GET | `/api/senders` | Active senders (no secrets) and current-hour usage |
| POST | `/api/campaigns` | Create a campaign and schedule its emails |
| GET | `/api/campaigns` | The user's campaigns with progress counts |
| GET | `/api/emails` | `?view=scheduled\|sent&cursor=&limit=25` |
| GET | `/api/emails/:id` | Details for one email |
| POST | `/api/emails/:id/cancel` | Cancel a scheduled or deferred email (P2) |
| GET | `/api/stats` | `{ scheduled, deferred, sentToday, failed }` |
| GET | `/api/search` | `?q=&status=&cursor=` (Elasticsearch) |
| GET | `/api/integrations/slack` | `{ connected, teamName?, channelName? }` |
| POST | `/api/integrations/slack/authorize` | Returns `{ url }` (Slack authorize URL with signed state) |
| GET | `/api/integrations/slack/callback` | Slack redirect target. Exchanges the code, stores the connection, then redirects to `/dashboard/settings?slack=connected` |
| DELETE | `/api/integrations/slack` | Disconnect (revokes the token and deletes the row) |
| POST | `/api/integrations/slack/test` | Sends a test message |
| GET | `/admin/queues` | Bull Board (basic auth) |

### `POST /api/campaigns`

Headers: `Idempotency-Key: <uuid>`. This makes a double-clicked Schedule button create only one campaign.

```jsonc
// request (shared Zod: CreateCampaignSchema)
{
  "subject": "Quick question about {{company}}",
  "body": "Hi there, ...",
  "recipients": ["a@x.com", "b@y.com"],     // deduped, ≤ 5000
  "startAt": "2026-10-25T09:30:00.000Z",     // ISO, UTC
  "delaySeconds": 2,                          // ≥ 1
  "hourlyLimit": 100,                         // ≥ 1, clamped to server max
  "senderIds": ["…"]                          // optional, default all active
}
// 201
{ "campaignId": "…", "scheduled": 1240, "firstAt": "…", "estimatedFinishAt": "…" }
```

**Errors:** `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `409 DUPLICATE_REQUEST` (returns the existing campaign), `422 START_IN_PAST`.

### `GET /api/emails?view=scheduled`

```jsonc
{
  "items": [
    { "id": "…", "recipient": "a@x.com", "subject": "…",
      "status": "deferred", "scheduledAt": "…", "nextAttemptAt": "…",
      "sentAt": null, "senderLabel": "Sender B", "previewUrl": null,
      "error": null, "deferReason": "Sender hourly limit (200/h) reached" }
  ],
  "nextCursor": "eyJ0IjoiMjAy…"   // base64 of (sort_ts, id)
}
```

- `view=scheduled` returns rows with status in (`scheduled`, `deferred`, `sending`), ordered by `next_attempt_at` ascending.
- `view=sent` returns rows with status in (`sent`, `failed`), ordered by `sent_at` descending (falling back to `updated_at` for failed rows).

## 6. Frontend specification (Next.js)

### 6.1 Auth flow

1. On `/login`, the "Continue with Google" button calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: <origin>/auth/callback?next=/dashboard }})`.
2. Google sends the user to Supabase, which sends them to `/auth/callback`. That route calls `exchangeCodeForSession` and redirects to `next`.
3. `middleware.ts` refreshes the session cookie on every request. Visiting `/dashboard/*` without a session redirects to `/login?next=…`. Visiting `/login` with a session redirects to `/dashboard`.
4. `lib/api.ts` reads the access token from the Supabase client and sends it as a Bearer token to the Express API.
5. The header reads `user.user_metadata.full_name`, `avatar_url`, and `email`.
6. Logout calls `supabase.auth.signOut()`, then `router.replace('/')`.

### 6.2 Pages

| Route | Render | Contents |
|---|---|---|
| `/` | Static (RSC) | Nav (logo, "Sign in"). Hero: headline, subcopy, primary call to action "Get started with Google", secondary "View on GitHub". A product screenshot. "How it works" in 3 steps (Upload → Pace → Send). A feature grid of 6 (Delayed jobs, Restart-safe, Rate limits, Exactly-once, Slack alerts, Search). A short tech strip. Footer. |
| `/login` | Client | A centered card: logo, "Sign in to Cadence", Google button, small legal text. Shows an error state if the OAuth error parameter is present. |
| `/auth/callback` | Route handler | Code exchange and redirect. |
| `/dashboard` | Server | Redirects to `/dashboard/scheduled`. |
| `/dashboard/scheduled` | Client islands | Stat cards (4), toolbar (search input, "Compose" button), `EmailTable view="scheduled"`, polling every 5 seconds. |
| `/dashboard/sent` | Client islands | Same shell. `EmailTable view="sent"` with a Preview link column and an error tooltip. |
| `/dashboard/search` | Client | Uses `?q=`. A results table with status filter chips. Highlighted matches. |
| `/dashboard/settings` | Client | **Integrations:** a Slack card (Connect, or Connected to #channel in Workspace, with Test and Disconnect). **Senders:** a list with this hour's usage meter. **Limits:** read-only values from the server (concurrency, minimum gap, hourly cap). A link to Bull Board. |
| Compose | Dialog | Opened by the button or `?compose=1`. See §6.3. |

**Dashboard layout (`dashboard/layout.tsx`):** `AppHeader` (logo, global search, user menu with avatar, name, email, a Queue dashboard link, and Log out). Under it sit the `DashboardTabs` (Scheduled · Sent · Settings, as links with an active indicator) and the page content.

### 6.3 Compose dialog

```
Subject*                [______________________________]
Body*                   [ textarea, 8 rows, char count  ]
Leads*                  [ drop CSV/TXT or click ]  → "1,240 emails detected · 12 duplicates · 3 invalid removed"  [preview first 5 ▾]
Send from               [ Sender A ✓ ] [ Sender B ✓ ] [ Sender C ✓ ]
Start time*             [ date ] [ time ]   ( Send now )
Delay between emails    [ 2 ] seconds
Hourly limit            [ 100 ] emails / hour / sender
────────────────────────────────────────────────
Est. finish: Today, 6:42 PM (≈ 4h 8m)        [Cancel] [Schedule 1,240 emails]
```

- **CSV parsing (`lib/csv.ts`):** Papa Parse with `header: false`. Every cell in every row is scanned and matched against an email regex, lowercased and trimmed, then deduplicated. If a header row has a column named `email`, only that column is used. TXT files are split on newlines, commas, and semicolons.
- **Estimate:** `perSenderRate = min(3600 / delaySeconds, hourlyLimit)`. Total time ≈ `count / (perSenderRate × senders)` hours.
- **Submit** sends the `Idempotency-Key` (generated once per dialog open) and disables the button while the request is pending. On success it shows a toast, invalidates the `['emails']` and `['stats']` queries, and closes the dialog.

### 6.4 State, data, and error handling

- TanStack Query keys: `['emails', view, cursor]`, `['stats']`, `['search', q, status]`, `['slack']`, `['senders']`.
- Polling: `refetchInterval: 5000` on scheduled and stats, paused when the document is hidden.
- `api.ts` throws a typed `ApiError`. A 401 triggers sign-out and a redirect. Other errors show a sonner toast with `error.message`.
- Every list has three states: a skeleton (5 rows), an empty state (illustration-free icon, title, body, and call to action), and an inline error with Retry.

## 7. Scheduling design

### 7.1 Creating a campaign (`scheduler.service.ts`)

1. Validate with Zod. Clamp `hourlyLimit` to `MAX_EMAILS_PER_HOUR_PER_SENDER`.
2. In **one transaction**:
   - Insert the campaign. A conflict on `(user_id, idempotency_key)` returns the existing campaign.
   - For recipient index `i`:
     - `sender = senders[i % senders.length]`
     - `scheduled_at = startAt + i × delayMs`
   - Batch-insert the email rows (chunks of 1,000) with `next_attempt_at = scheduled_at`.
3. **After commit**, enqueue with `emailQueue.addBulk` in chunks of 500:
   ```ts
   { name: 'send', data: { emailId }, opts: {
       jobId: emailId,                         // dedupe key
       delay: Math.max(0, scheduledAt - Date.now()),
       attempts: 3, backoff: { type: 'exponential', delay: 5000 },
       removeOnComplete: { age: 86400, count: 10000 },
       removeOnFail: { age: 7 * 86400 } } }
   ```
4. Index the emails in Elasticsearch with a bulk request (fire and forget, logging any failure).

If the process dies between steps 2 and 3, the rows exist without jobs. The **reconciler** (§8) fixes this on the next boot, so creation is crash-safe.

### 7.2 The worker (`sendEmail.processor.ts`)

```
Worker('email-send', processor, {
  connection, concurrency: WORKER_CONCURRENCY,
  lockDuration: 60_000, stalledInterval: 30_000, maxStalledCount: 1 })
```

Processor steps for `{ emailId }`:

1. **Load** the email, campaign, and sender.
   - If the status is `sent`, `failed`, or `cancelled`, return immediately. (This makes the processor idempotent.)
   - If the status is `sending` and `claimed_at` is older than the lease (2 minutes), the previous attempt was interrupted. Mark the email `failed` with error `interrupted` and return. This is at-most-once by design.
2. **Not yet eligible?** If `now < next_attempt_at` (clock skew or a manual retry), move the job back to delayed until `next_attempt_at`.
3. **Reserve capacity** atomically using the Redis Lua script (§9.2). It returns one of:
   - `OK`: proceed.
   - `WAIT gapMs`: the minimum gap for this sender has not elapsed. Call `job.moveToDelayed(now + gapMs, token)` and throw `DelayedError`. The status stays `scheduled`.
   - `LIMIT scope windowStart`: the hourly cap was hit. Go to §9.3 (defer).
4. **Claim** in Postgres with a conditional update:
   ```sql
   update emails set status='sending', claimed_at=now(), attempts=attempts+1
   where id=$1 and status in ('scheduled','deferred') returning *;
   ```
   If no row comes back, another worker already has it, so return. This is the core idempotency guard.
5. **Send** through Nodemailer using the cached transport for the sender. Set `messageId: <emailId@cadence.local>`, which gives a deterministic Message-ID.
6. **On success:**
   - Update the row: `status='sent'`, `sent_at`, `message_id`, `preview_url = nodemailer.getTestMessageUrl(info)`.
   - Update the Elasticsearch document.
7. **On SMTP error:**
   - If retries remain, revert the row to `scheduled` (clearing `claimed_at`) and rethrow so BullMQ retries with backoff.
   - On the final attempt, mark it `failed` with the error message.
   - Update the Elasticsearch document in both cases.

## 8. Persistence and restart behavior

| Failure | What happens |
|---|---|
| **API restarts** | Nothing is lost. Jobs live in Redis and rows live in Postgres. |
| **Worker restarts (graceful)** | `SIGTERM` triggers `worker.close()`, which waits for active jobs to finish. Delayed jobs stay in Redis. When the worker comes back, overdue delayed jobs are promoted and run immediately, exactly once (thanks to the claim). |
| **Worker crashes mid-job** | The BullMQ lock expires and the job is marked stalled and retried once. The processor sees `sending` plus an expired lease and marks the email `failed` (`interrupted`) instead of sending again. If the crash happened **before the claim**, the retry simply sends normally. |
| **Redis restarts** | Docker runs Redis with `appendonly yes` and `appendfsync everysec`, so delayed jobs survive. |
| **Redis data wiped** | The **boot reconciler** in the worker selects every email with status in (`scheduled`, `deferred`) and calls `addBulk` with `jobId = id` and `delay = next_attempt_at - now`. Existing job IDs are ignored by BullMQ (deduplication), so running the reconciler is always safe. |
| **Elasticsearch is down** | Indexing failures are logged and the email pipeline is unaffected. `pnpm reindex` rebuilds the index from Postgres. |

The reconciler runs **once at worker startup**, not on a timer, so it complies with the no-cron rule. It is guarded by a Redis lock (`SET reconcile:lock NX EX 60`) so that only one instance runs it.

## 9. Rate limiting, delay, and concurrency

### 9.1 Configuration (environment variables, no hardcoding)

| Variable | Default | Meaning |
|---|---|---|
| `WORKER_CONCURRENCY` | `5` | Parallel jobs per worker process |
| `MIN_SEND_GAP_MS` | `2000` | Minimum gap between two sends **from the same sender**, across all workers |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` | Hard cap per sender per UTC hour |
| `GLOBAL_LIMITER_MAX` / `GLOBAL_LIMITER_DURATION_MS` | `10` / `1000` | BullMQ queue-wide limiter, an extra safety net for the SMTP provider |
| Campaign `hourlyLimit` | from the form | Per-campaign cap. The effective cap is `min(campaign, sender)`. |

### 9.2 Atomic reservation (`lua/reserve_send.lua`)

The script uses these keys:

| Key | Purpose |
|---|---|
| `rl:s:{senderId}:{YYYYMMDDHH}` | Sender hourly counter |
| `rl:c:{campaignId}:{YYYYMMDDHH}` | Campaign hourly counter |
| `gap:s:{senderId}` | Next allowed send timestamp for the sender (ms) |

It takes these arguments: `nowMs`, `senderLimit`, `campaignLimit`, `minGapMs`, `ttlSec=7200`.

```lua
local nextAllowed = tonumber(redis.call('GET', KEYS[3]) or '0')
if nowMs < nextAllowed then return {'WAIT', nextAllowed - nowMs} end
local s = tonumber(redis.call('GET', KEYS[1]) or '0')
local c = tonumber(redis.call('GET', KEYS[2]) or '0')
if s >= senderLimit then return {'LIMIT', 'sender'} end
if c >= campaignLimit then return {'LIMIT', 'campaign'} end
redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], ttl)
redis.call('INCR', KEYS[2]); redis.call('EXPIRE', KEYS[2], ttl)
redis.call('SET', KEYS[3], nowMs + minGapMs, 'PX', minGapMs * 10)
return {'OK'}
```

Because the whole check-and-increment runs as one Lua script, it is atomic in Redis. Any number of workers or instances share the same counters, and nothing is held in memory.

**Edge case:** if the claim or send fails after a successful reservation, the counter stays incremented. This conservatively under-sends and never over-sends. That trade-off is documented.

### 9.3 Deferral (order-preserving)

When the result is `LIMIT`:

1. `nextWindowStart` is the top of the next UTC hour.
2. Take an ordered slot in that window: `slot = INCR defer:{scope}:{scopeId}:{nextWindowKey}`, with a 2-hour TTL.
3. `newTime = nextWindowStart + (slot - 1) × max(MIN_SEND_GAP_MS, campaign.delay_ms)`.
4. Update the row: `status='deferred'`, `next_attempt_at=newTime`, `defer_reason`.
5. Call `job.moveToDelayed(newTime, token)` and throw `DelayedError`. Attempts are **not** consumed, and the job is never failed.
6. **Notify:** `SET slack:notified:{userId}:{senderId}:{windowKey} 1 NX EX 7200`. Only if that succeeds, enqueue a job on the `notifications` queue and insert a `rate_limit_events` row.

Jobs reach the limit in roughly their scheduled order (they are sorted by delay), so slot numbers preserve that order in the next window. If the next window also overflows, the same logic pushes the job forward again.

### 9.4 Concurrency safety

- **Database claim** (`update … where status in (…) returning`): no two workers can send the same email.
- **`jobId = emailId`:** BullMQ will not hold two jobs for one email.
- **Lua reservation:** the counters and the gap cannot race.
- **Separate transports per sender,** pooled (`pool: true, maxConnections: 2`).

### 9.5 Behavior under load: 1,000+ emails at the same instant

Example: 1,000 recipients, 3 senders, `delay=2s`, `hourlyLimit=200`, `MIN_SEND_GAP_MS=2000`, concurrency 5.

1. The API inserts 1,000 rows and enqueues 1,000 delayed jobs (2 `addBulk` calls) in about 1 second.
2. Planned times are spaced by the delay. Each sender has about 333 emails spaced 6 seconds apart.
3. The worker runs up to 5 jobs in parallel, but the per-sender gap means each sender sends at most one email every 2 seconds. The global limiter caps the total rate.
4. After 200 sends per sender in the current hour, the next jobs get `LIMIT`. They are deferred into the next hour in order, and **one Slack alert per sender** goes out.
5. Result: about 600 emails per hour in total. All 1,000 are sent in about 1 hour 40 minutes with no drops, duplicates, or failures caused by limits.

The same steps apply at 10,000 or more, only with more windows. Redis memory per delayed job is about 1 KB, so 100,000 jobs take about 100 MB, which is acceptable.

The script `pnpm load-test --count 1000 --start now` makes this reproducible.

## 10. Slack integration

**Slack app setup:**
- OAuth scopes: `incoming-webhook` and `chat:write`.
- Redirect URL: `${API_URL}/api/integrations/slack/callback`.
- Distribution: enable it for public distribution so that any workspace can install it.

**Flow:**

1. The user clicks Connect. The web app calls `POST /api/integrations/slack/authorize` with the JWT. The API returns `https://slack.com/oauth/v2/authorize?client_id=…&scope=incoming-webhook,chat:write&redirect_uri=…&state=<JWT signed with STATE_SECRET {userId, nonce, exp:10m}>`.
2. The browser goes to Slack. The user picks a channel and approves.
3. Slack redirects to `/callback?code&state`. The API verifies the state, calls `oauth.v2.access`, encrypts and upserts `slack_connections` (webhook URL, token, team name, channel), and redirects to `${WEB_URL}/dashboard/settings?slack=connected`.
4. **Notify processor** (on the `notifications` queue, with 5 attempts and backoff):
   - Look up the user's connection **at send time**. This is why connect and disconnect take effect immediately without a redeploy.
   - If there is no connection, complete the job silently.
   - Otherwise, POST a Block Kit message to the webhook: _":warning: Hourly limit reached — Sender A (200/200, 14:00–15:00 UTC). 37 emails deferred to 15:00."_
   - If Slack returns 404 or `invalid_token`, delete the connection and mark the user disconnected.
5. **Disconnect:** call `auth.revoke` with the token (best effort), then delete the row.

## 11. Elasticsearch

**Index:** `cadence-emails-v1` with the alias `cadence-emails`.

```json
{ "mappings": { "properties": {
  "id": {"type":"keyword"}, "userId": {"type":"keyword"},
  "campaignId": {"type":"keyword"}, "status": {"type":"keyword"},
  "recipient": {"type":"text","fields":{"raw":{"type":"keyword"}}},
  "subject": {"type":"text"}, "body": {"type":"text"},
  "senderLabel": {"type":"keyword"},
  "scheduledAt": {"type":"date"}, "sentAt": {"type":"date"}
}}}
```

- **Writes:** a bulk index at campaign creation, then a partial update on each status change from the worker. The document ID is the email ID, so writes are idempotent.
- **Query:** a `bool` query with `filter: [term userId, terms status?]` and `must: multi_match(q, [recipient^3, subject^2, body])`, plus highlighting. Pagination uses `search_after`.
- **Reindex:** `scripts/reindex.ts` streams from Postgres into a new index version and swaps the alias.

## 12. Security

- **JWT:** verified with `jose.createRemoteJWKSet(${SUPABASE_URL}/auth/v1/.well-known/jwks.json)`, checking `aud=authenticated` and `iss`. `req.user = { id, email }`.
- **Authorization:** every query filters by `user_id = req.user.id`. Elasticsearch queries are always filtered by `userId`.
- **Secrets:** SMTP passwords and Slack tokens are encrypted with AES-256-GCM using `ENCRYPTION_KEY` (32 bytes, base64).
- **HTTP:** `helmet`, CORS restricted to `WEB_URL`, a 1 MB JSON limit, and `express-rate-limit` on `POST /api/campaigns` (10 requests per minute per user).
- **Bull Board:** basic auth using `BULL_BOARD_USER` and `BULL_BOARD_PASS`.
- **Slack OAuth:** the signed, expiring `state` protects against CSRF.

## 13. Environments and deployment

### 13.1 Local

```bash
docker compose up -d                  # redis (AOF) + elasticsearch (single-node, security off)
pnpm i
pnpm --filter api db:migrate
pnpm --filter api seed:senders        # creates 3 Ethereal accounts via nodemailer.createTestAccount()
pnpm dev                              # turbo: web :3000, api :4000, worker
```

### 13.2 Hosted

| Piece | Host |
|---|---|
| Web | **Vercel** |
| API and worker | **Railway**, as two services from the same repo (`start:api`, `start:worker`). BullMQ workers need a long-running process, which Vercel functions cannot provide. |
| Redis | Railway Redis, with persistence on |
| Postgres and Auth | **Supabase** |
| Elasticsearch | **Elastic Cloud** (trial) or Bonsai |
| OAuth redirects | Google allows the Supabase callback. Supabase allows the Vercel URL. The Slack redirect points to the Railway API URL. |

Verify that the host allows outbound SMTP on port 587 to Ethereal before you rely on it.

### 13.3 `.env.example`

```bash
# api
PORT=4000
WEB_URL=http://localhost:3000
DATABASE_URL=postgresql://...supabase...:5432/postgres
SUPABASE_URL=https://xxx.supabase.co
REDIS_URL=redis://localhost:6379
ELASTICSEARCH_URL=http://localhost:9200
ENCRYPTION_KEY=base64-32-bytes
STATE_SECRET=random-long-string
WORKER_CONCURRENCY=5
MIN_SEND_GAP_MS=2000
MAX_EMAILS_PER_HOUR_PER_SENDER=200
GLOBAL_LIMITER_MAX=10
GLOBAL_LIMITER_DURATION_MS=1000
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_REDIRECT_URI=http://localhost:4000/api/integrations/slack/callback
BULL_BOARD_USER=admin
BULL_BOARD_PASS=change-me
# web
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_URL=http://localhost:4000
```

## 14. Testing strategy

| Level | What |
|---|---|
| Unit | CSV parser (dedupe, header detection, invalid entries). Schedule math. Estimate math. Window key and next-window computation. Encryption round-trip. |
| Integration (Redis testcontainer) | Lua reservation under 50 parallel calls never exceeds the limit. Deferral slots are monotonic. Duplicate `addBulk` with the same job ID produces one job. |
| Integration (API) | Campaign creation with an `Idempotency-Key` repeated twice produces one campaign. Authorization scoping: user A cannot read user B's emails. |
| End-to-end, manual | The restart test, the rate limit plus Slack, and disconnect/reconnect, scripted in the README. |

## 15. Observability

- pino logs with fields `{ emailId, campaignId, senderId, jobId, attempt }`.
- `/health` returns the status of each dependency.
- Bull Board for queue state. The `rate_limit_events` table serves as an audit trail.

## 16. Explicitly not used

- `node-cron`, `agenda`, crontab, and BullMQ repeatable jobs.
- MongoDB (the data is relational: campaigns, emails, senders).
- Next.js API routes as the backend. The API and worker live in a dedicated Express service, so Next.js handles only the UI and the auth callback.
