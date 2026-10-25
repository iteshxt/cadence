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
| Frontend | **Next.js 16** (App Router, React Server Components) + **TypeScript** | Server-side auth guards and fast page loads. Next.js 16 renamed `middleware.ts` to `proxy.ts`. |
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
| Infrastructure | **Docker Compose** (Redis 7, Elasticsearch 8; in production also the API, the worker, and Caddy) | One command to start, locally and on the free VM (§13) |
| Hosting | **Vercel Hobby** (web) + **Oracle Cloud Always Free VM** (everything else) + **Supabase Free** | $0. See §13 for why the backend can't go on Vercel or a free PaaS. |

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
│  │  │  ├─ layout/              # AppHeader (nav + counts), UserMenu
│  │  │  ├─ emails/              # EmailTable (hour groups), StatusMark, EmptyState
│  │  │  ├─ pace/                # PaceStrip, Readouts (design.md §7.1–7.2)
│  │  │  ├─ compose/             # ComposePanel, RecipientsDropzone, PacingFields, ComposePreview
│  │  │  └─ settings/            # SlackCard, SendersCard
│  │  ├─ lib/
│  │  │  ├─ supabase/{client,server,proxy}.ts
│  │  │  ├─ api.ts               # typed fetch wrapper (adds Bearer token)
│  │  │  ├─ csv.ts               # parse + dedupe + validate leads
│  │  │  └─ format.ts            # dates, numbers
│  │  ├─ hooks/                  # useEmails, useStats, useTimeline, useSlackStatus…
│  │  └─ proxy.ts                # refresh session, protect /dashboard (Next.js 16 name for middleware)
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
│  └─ shared/                    # Zod schemas, DTO types, enums, pacing math
│     └─ src/{schemas.ts,types.ts,constants.ts,pacing.ts}
├─ deploy/
│  ├─ docker-compose.prod.yml    # api + worker + redis + elasticsearch + caddy (on the VM)
│  └─ Caddyfile                  # automatic HTTPS for the API
├─ docs/
│  └─ prd.md · tech-spec.md · design.md
├─ docker-compose.yml            # local: redis + elasticsearch
├─ turbo.json · pnpm-workspace.yaml · .env.example
├─ CLAUDE.md · README.md
```

## 4. Data model (Postgres / Drizzle)

Supabase owns `auth.users`. We mirror the profile fields we need into `public.profiles`. The **auth middleware upserts the profile** from the verified JWT claims (`email`, `user_metadata.full_name`, `user_metadata.avatar_url`) before any route handler runs, so the foreign keys below always resolve. A small in-process cache (user ID → last upsert, 10-minute TTL) avoids a write on every request. No trigger on `auth.users` is needed, so migrations never touch the `auth` schema.

```sql
create extension if not exists citext;

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
  delay_ms        int  not null check (delay_ms >= 1000),    -- user's "delay between emails"
  hourly_limit    int  not null check (hourly_limit > 0),    -- campaign-wide emails per hour
  interval_ms     int  not null,                             -- effective spacing, see §7.1
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
  sent_at         timestamptz,            -- set only when status → sent
  finished_at     timestamptz,            -- set when status → sent or failed (Sent tab sort key)
  attempts        int not null default 0,
  claimed_at      timestamptz,            -- set when status → sending
  message_id      text,
  preview_url     text,
  error           text,
  defer_scope     text,                   -- 'sender' | 'campaign'; UI builds the tooltip copy
  defer_limit     int,                    -- the cap that was hit, e.g. 200
  version         int not null default 1, -- +1 on every update; Elasticsearch external version
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (campaign_id, recipient)         -- no duplicate recipient per campaign
);
create index emails_user_status_next on emails (user_id, status, next_attempt_at, id);
create index emails_user_finished    on emails (user_id, finished_at desc, id) where status in ('sent','failed');

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
  window_key  text not null,              -- UTC hour index, floor(ms / 3600000), e.g. '494182'
  scope       text not null,              -- 'sender' | 'campaign'
  notified    boolean not null default false,
  created_at  timestamptz not null default now()
);
```

**Status lifecycle**

| From | To | When |
|---|---|---|
| `scheduled` / `deferred` | `sending` | The worker reserved capacity and won the claim (§7.2 step 4) |
| `scheduled` / `deferred` | `deferred` | An hourly limit was hit **before** the claim (§9.3) |
| `scheduled` / `deferred` | `cancelled` | The user cancelled (P2) |
| `sending` | `sent` | SMTP accepted the message |
| `sending` | `scheduled` | A *retryable* SMTP error with attempts left (§7.2 step 7) |
| `sending` | `failed` | Final attempt failed, an ambiguous SMTP error, or the lease expired (`interrupted`) |

Every update sets `updated_at = now()` and `version = version + 1`.

## 5. API specification (Express)

The base URL is `/api`. Every route except health, the Slack callback, and Bull Board requires `Authorization: Bearer <supabase_access_token>`. Responses are JSON. Errors use the shape `{ error: { code, message, details? } }`.

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness, plus Redis, database, and Elasticsearch checks |
| GET | `/api/me` | Profile (upserted by the auth middleware) |
| GET | `/api/config` | Read-only limits for the UI: `{ workerConcurrency, minSendGapMs, maxPerHourPerSender, maxRecipients, startGraceMs }` |
| GET | `/api/senders` | Active senders (no secrets) and current-hour usage |
| POST | `/api/campaigns` | Create a campaign and schedule its emails |
| GET | `/api/campaigns` | The user's campaigns with progress counts |
| GET | `/api/emails` | `?view=scheduled\|sent&cursor=&limit=25` |
| GET | `/api/emails/:id` | Details for one email |
| POST | `/api/emails/:id/cancel` | Cancel a scheduled or deferred email (P2) |
| GET | `/api/stats` | `{ scheduled, deferred, sending, sentToday, sentLastHour, sentTotal, failed, nextSendAt, lastPlannedAt }` ("today" is the UTC day; `sentTotal` counts `sent` + `failed` for the Sent nav count; `nextSendAt` / `lastPlannedAt` are the min / max `next_attempt_at` of pending emails, for the "Next send" and "Finishes around" readouts) |
| GET | `/api/timeline` | `?from=&to=` → data for the pace strip (see below) |
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
  "subject": "Quick question",
  "body": "Hi there, ...",
  "recipients": ["a@x.com", "b@y.com"],     // deduped, ≤ 5000
  "startAt": "2026-10-25T09:30:00.000Z",     // ISO, UTC. "Send now" sends the client's current time.
  "delaySeconds": 2,                          // ≥ 1, minimum spacing between emails of this campaign
  "hourlyLimit": 100,                         // 1–3600, emails per hour for the whole campaign
  "senderIds": ["…"]                          // optional, default all active
}
// 201
{ "campaignId": "…", "scheduled": 1240, "intervalSeconds": 36,
  "firstAt": "…", "estimatedFinishAt": "…" }
```

- **Start time grace:** `startAt` may be up to `START_GRACE_MS` (5 minutes) in the past, which covers "Send now" and slow requests. The server then uses `max(startAt, now)`. Anything older returns `422 START_IN_PAST`.
- `estimatedFinishAt` comes from the shared `estimateFinish()` in `packages/shared/src/pacing.ts`, the same function the Compose dialog uses (§6.3).

**Errors:** `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `409 DUPLICATE_REQUEST` (returns the existing campaign), `422 START_IN_PAST`.

### `GET /api/timeline?from=&to=`

Feeds the dashboard pace strip (design.md §7.1). The range is capped at 24 hours. The server picks a bucket size so each lane has at most 600 buckets (30 s for a 3-hour range); the client draws one tick per email when a bucket holds a single email and a density bar otherwise.

```jsonc
{
  "bucketMs": 30000,
  "senders": [{ "id": "…", "label": "Sender A", "cap": 200 }],
  "buckets": [   // only non-empty buckets
    { "senderId": "…", "t": "2026-10-25T09:30:00Z",
      "scheduled": 3, "sending": 0, "deferred": 0, "sent": 2, "failed": 0 }
  ],
  "windows": [   // one per sender per UTC hour in range
    { "senderId": "…", "hourStart": "2026-10-25T09:00:00Z", "used": 142, "cap": 200 }
  ]
}
```

- Pending emails are bucketed by `next_attempt_at`, finished ones by `finished_at`, both through the existing indexes and scoped to the user.
- `windows[].used` for the current and future hours is read from the Redis sender counters (`rl:s:{senderId}:{hourIndex}`), which are shared by all users; past hours come from Postgres.

### `GET /api/emails?view=scheduled`

```jsonc
{
  "items": [
    { "id": "…", "recipient": "a@x.com", "subject": "…",
      "status": "deferred", "scheduledAt": "…", "nextAttemptAt": "…",
      "sentAt": null, "finishedAt": null, "senderLabel": "Sender B", "previewUrl": null,
      "error": null, "deferScope": "sender", "deferLimit": 200 }
  ],
  "nextCursor": "eyJ0IjoiMjAy…",  // base64 of (sort_ts, id)
  "total": 1240                    // exact count for this view
}
```

- `view=scheduled` returns rows with status in (`scheduled`, `deferred`, `sending`), ordered by `(next_attempt_at, id)` ascending.
- `view=sent` returns rows with status in (`sent`, `failed`), ordered by `(finished_at, id)` descending.
- `total` is a plain `count(*)` on the same indexed filter, which is cheap at demo scale. It powers "Showing 1–25 of 1,240". **Prev** works from a client-side stack of the cursors already visited, so the API only needs forward cursors.
- The API returns structured defer fields. The UI writes the tooltip copy in the user's timezone (design.md §11): "Sender B reached 200/hour. Moved to 4:00 PM."

## 6. Frontend specification (Next.js)

### 6.1 Auth flow

1. On `/login`, the "Continue with Google" button calls `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: <origin>/auth/callback?next=/dashboard }})`.
2. Google sends the user to Supabase, which sends them to `/auth/callback`. That route calls `exchangeCodeForSession` and redirects to `next`.
3. `proxy.ts` (Next.js 16's name for `middleware.ts`) refreshes the session cookie on every request. Visiting `/dashboard/*` without a session redirects to `/login?next=…`. Visiting `/login` with a session redirects to `/dashboard`.
4. `lib/api.ts` reads the access token from the Supabase client and sends it as a Bearer token to the Express API.
5. The header reads `user.user_metadata.full_name`, `avatar_url`, and `email`.
6. Logout calls `supabase.auth.signOut()`, then `router.replace('/')`.

### 6.2 Pages

| Route | Render | Contents |
|---|---|---|
| `/` | Static (RSC) plus one client island | Layout and copy per design.md §8.1: left-aligned hero with the scripted pace strip demo (client island, no API calls), "How a campaign runs" in 3 steps, "What happens when…" list, footer with the tech line. |
| `/login` | Client | A centered panel: mark, "Sign in to Cadence", Google button, small legal text. Shows an error banner if the OAuth error parameter is present. |
| `/auth/callback` | Route handler | Code exchange and redirect. |
| `/dashboard` | Server | Redirects to `/dashboard/scheduled`. |
| `/dashboard/scheduled` | Client islands | Page title with strip range control, `PaceStrip` (`/api/timeline`), `Readouts` (`/api/stats`), `EmailTable view="scheduled"` grouped by hour. Polls every 5 seconds. |
| `/dashboard/sent` | Client islands | Same shell, strip showing the last 3 hours. `EmailTable view="sent"` with the "View in Ethereal" link and failure reasons inline. |
| `/dashboard/search` | Client | Uses `?q=`. A results table (no hour groups) with a status segmented control and highlighted matches. |
| `/dashboard/settings` | Client | Sections per design.md §8.4: **Slack** (Connect, or Connected to #channel in Workspace, with Send test message and Disconnect). **Senders** with this hour's usage meter. **Sending limits** from `GET /api/config`. A link to Bull Board. |
| Compose | Side panel | Opened by the button or `?compose=1`. See §6.3. |

**Dashboard layout (`dashboard/layout.tsx`):** a single `AppHeader`: lockup, nav links with counts (Scheduled, Sent, Settings), global search, the Compose button, and the user menu (avatar, name, email, Settings, Queue dashboard, Log out). There is no separate sub-navigation bar. See design.md §7.4.

### 6.3 Compose panel

Layout per design.md §7.5: form on the left, live preview on the right.

```
Form (left)                                      Preview (right, sticky)
Subject*        [______________________]         [ pace strip: planned sends per sender ]
Message*        [ textarea, 8 rows, count ]      First send       Finishes around
Recipients*     [ drop CSV/TXT or browse ]       3:40 PM          Tomorrow, 4:04 AM
                "1,240 emails ready"             Per sender each hour
                "Removed 12 duplicates and       33
                 3 invalid addresses"            (capacity warning, if any)
Send from       [Sender A ✓] [Sender B ✓] [C ✓]  First 5 recipients
Start*          [date] [time]  (Send now)
Delay between emails  [ 2 ] seconds
Hourly limit          [ 100 ] emails per hour
                "1 email every 36 seconds"
────────────────────────────────────────────────────────────────────────────
                                                 [Cancel] [Schedule 1,240 emails]
```

- The preview's pace strip and readouts are computed client-side from `estimateFinish()` (it returns the per-email planned times and sender assignments as well as the finish time), so they update instantly as fields change.

- **CSV parsing (`lib/csv.ts`):** Papa Parse with `header: false`. Every cell in every row is scanned and matched against an email regex, lowercased and trimmed, then deduplicated. If a header row has a column named `email`, only that column is used. TXT files are split on newlines, commas, and semicolons.
- **Pacing semantics:**
  - **Delay between emails** is the minimum spacing between two emails of *this campaign*, across all its senders.
  - **Hourly limit** is the maximum number of emails *this campaign* sends per hour, across all its senders.
  - The two combine into one spacing: `intervalMs = max(delayMs, ceil(3_600_000 / hourlyLimit))`. The helper caption shows it ("1 email every 36 s").
- **Estimate:** `estimateFinish({ count, startAt, intervalMs, senderCount, maxPerHourPerSender, minSendGapMs })` from `packages/shared/src/pacing.ts`. It simulates the plan email by email, including deferral into the next UTC hour when a sender's cap is reached, so the preview matches what the worker will actually do. 5,000 iterations take well under a millisecond.
- **Capacity warning:** if the planned rate per sender (`3600 / (intervalSeconds × senderCount)`) exceeds `maxPerHourPerSender`, show a caption in `--deferred`: "Your senders can send 600 emails an hour in total. The rest will move to the next hour." This is allowed, because deferral is a feature, not an error.
- **Submit** sends the `Idempotency-Key` (generated once per panel open) and disables the button while the request is pending. On success it shows a toast, invalidates the `['emails']`, `['stats']` and `['timeline']` queries, and closes the panel.

### 6.4 State, data, and error handling

- TanStack Query keys: `['emails', view, cursor]`, `['stats']`, `['timeline', from, to]`, `['search', q, status]`, `['slack']`, `['senders']`, `['config']`.
- Polling: `refetchInterval: 5000` on scheduled, stats, and timeline, paused when the document is hidden.
- `api.ts` throws a typed `ApiError`. A 401 triggers sign-out and a redirect. Other errors show a sonner toast with `error.message`.
- Every list has three states: a skeleton (5 rows), an empty state (illustration-free icon, title, body, and call to action), and an inline error with Retry.

## 7. Scheduling design

### 7.1 Creating a campaign (`scheduler.service.ts`)

1. Validate with Zod. Apply the start grace: `startAt = max(startAt, now)` if it is within `START_GRACE_MS`, otherwise `422`.
2. Compute `intervalMs = max(delayMs, ceil(3_600_000 / hourlyLimit))`. The campaign hourly limit is a **planning** constraint, so a single campaign never needs deferral to respect it. The sender cap is a **runtime** constraint shared by every campaign, and that is what deferral (§9.3) and Slack alerts are for.
3. In **one transaction**:
   - Insert the campaign. A conflict on `(user_id, idempotency_key)` returns the existing campaign.
   - For recipient index `i`:
     - `sender = senders[i % senders.length]`
     - `scheduled_at = startAt + i × intervalMs`
   - Batch-insert the email rows (chunks of 1,000) with `next_attempt_at = scheduled_at`.
4. **After commit**, enqueue with `emailQueue.addBulk` in chunks of 500:
   ```ts
   { name: 'send', data: { emailId }, opts: {
       jobId: emailId,                         // dedupe key
       delay: Math.max(0, scheduledAt - Date.now()),
       attempts: 3, backoff: { type: 'exponential', delay: 5000 },
       removeOnComplete: { age: 86400, count: 10000 },
       removeOnFail: { age: 7 * 86400 } } }
   ```
5. Index the emails in Elasticsearch with a bulk request (fire and forget, logging any failure). Every write is versioned (§11), so this can safely race with the worker's updates.

If the process dies between steps 3 and 4, the rows exist without jobs. The **reconciler** (§8) fixes this when the API or the worker next boots, so creation is crash-safe.

### 7.2 The worker (`sendEmail.processor.ts`)

```
Worker('email-send', processor, {
  connection, concurrency: WORKER_CONCURRENCY,
  lockDuration: 60_000, stalledInterval: 30_000, maxStalledCount: 1 })
```

Processor steps for `{ emailId }`:

1. **Load** the email, campaign, and sender.
   - If the status is `sent`, `failed`, or `cancelled`, return immediately. (This makes the processor idempotent.)
   - If the status is `sending`, a previous attempt claimed it and then disappeared (a crash, or a stalled job).
     - If `claimed_at` is older than the lease (`SEND_LEASE_MS`, 2 minutes), mark the email `failed` with error `interrupted` and return. This is at-most-once by design.
     - If the lease has **not** expired yet, call `job.moveToDelayed(claimed_at + SEND_LEASE_MS, token)` and throw `DelayedError`, so the job checks again once the lease is over. Never "return" here, because that would leave the row stuck in `sending` forever.
2. **Not yet eligible?** If `now < next_attempt_at` (clock skew or a manual retry), move the job back to delayed until `next_attempt_at`.
3. **Reserve a send slot** atomically using the Redis Lua script (§9.2), unless `job.data.slotAt` is already set (the job reserved a slot earlier and is waking up for it). The script returns one of:
   - `OK slotAt`, with `slotAt ≤ now + 50 ms`: proceed.
   - `OK slotAt`, with `slotAt` in the future: the slot is reserved but the sender's minimum gap hasn't elapsed. Call `job.updateData({ ...data, slotAt })`, then `job.moveToDelayed(slotAt, token)` and throw `DelayedError`. The status stays as it is. Every waiting job gets its *own* slot, so they don't all wake at once and collide again.
   - `LIMIT scope`: the hourly cap for the slot's window was hit. Go to §9.3 (defer).
4. **Claim** in Postgres with a conditional update:
   ```sql
   update emails set status='sending', claimed_at=now(), attempts=attempts+1
   where id=$1 and status in ('scheduled','deferred') returning *;
   ```
   If no row comes back, another worker already has it, so return. This is the core idempotency guard.
5. **Send** through Nodemailer using the cached transport for the sender. Set `messageId: <emailId@cadence.local>`, which gives a deterministic Message-ID.
6. **On success:**
   - Update the row: `status='sent'`, `sent_at = finished_at = now()`, `message_id`, `preview_url = nodemailer.getTestMessageUrl(info)`.
   - Update the Elasticsearch document.
7. **On SMTP error**, classify it using Nodemailer's `err.command` and `err.responseCode`:
   - **Retryable:** the failure happened *before* the message data was sent. That means `err.command` is `CONN`, `EHLO`, `AUTH`, `MAIL FROM` or `RCPT TO` (or a connection error with no command), and there is no `5xx` response code. If attempts remain, revert the row to `scheduled` (clearing `claimed_at` and `job.data.slotAt`) and rethrow so BullMQ retries with backoff.
   - **Ambiguous:** the failure happened during or after `DATA`, for example a timeout or a dropped socket. The server may already have accepted the message, so retrying could send a duplicate. Mark it `failed` with error `ambiguous: <message>` and do not retry. This is the same rule as the PRD's at-most-once trade-off.
   - **Permanent** (`5xx`), or the final attempt: mark it `failed` with the error message and set `finished_at`.
   - Update the Elasticsearch document in every case.
8. **Any other error** (the database or Redis is briefly unavailable, or a bug): if attempts remain, rethrow so BullMQ retries. On the final attempt, make a best-effort update that marks the row `failed` with the reason, so a row never stays `scheduled` behind a failed BullMQ job. If that update also fails, the reconciler repairs the row on the next boot (§8).

## 8. Persistence and restart behavior

| Failure | What happens |
|---|---|
| **API restarts** | Nothing is lost. Jobs live in Redis and rows live in Postgres. |
| **Worker restarts (graceful)** | `SIGTERM` triggers `worker.close()`, which waits for active jobs to finish. Delayed jobs stay in Redis. When the worker comes back, overdue delayed jobs are promoted and run immediately, exactly once (thanks to the claim). |
| **Worker crashes mid-job** | The BullMQ lock expires (about 60–90 s) and the job is marked stalled and retried once. If the crash happened **after the claim**, the processor sees `sending`. It waits out the rest of the lease (§7.2 step 1), then marks the email `failed` (`interrupted`) instead of sending again. If the crash happened **before the claim**, the retry simply sends normally. |
| **Job stalls twice** | BullMQ fails the job (`maxStalledCount: 1`). The row may be left in `sending`. The reconciler marks it `failed` (`interrupted`) on the next boot. |
| **Redis restarts** | Redis runs with `appendonly yes`, `appendfsync everysec` and `maxmemory-policy noeviction` (BullMQ requires that), so delayed jobs survive. |
| **Redis data wiped** | The reconciler re-creates every missing job from Postgres (see below). |
| **Elasticsearch is down** | Indexing failures are logged and the email pipeline is unaffected. `pnpm reindex` rebuilds the index from Postgres. |

**Reconciler (`reconciler.service.ts`).** It runs **once at startup of both the API and the worker**, not on a timer, so it complies with the no-cron rule. Running it in the API too covers a crash between commit and `addBulk` (§7.1), which can happen even if the worker never restarts. A Redis lock (`SET reconcile:lock NX EX 60`) makes sure only one process runs it at a time. It does three things:

1. **Expired `sending` rows** (`claimed_at` older than `SEND_LEASE_MS`) are marked `failed` with error `interrupted`.
2. **`scheduled` / `deferred` rows** are matched against Redis with `queue.getJob(id)`:
   - If there is no job, re-add it with `jobId = id` and `delay = max(0, next_attempt_at − now)`.
   - If the job is in a `completed` or `failed` state (a stale leftover kept by `removeOnComplete` / `removeOnFail`), remove it first and then re-add it. Otherwise BullMQ's job-ID deduplication would silently ignore the re-add and the email would never send.
   - If the job is waiting, delayed or active, leave it alone.
3. It logs a summary: `{ requeued, replaced, interrupted }`.

This is safe to run any number of times, because the database claim (§7.2 step 4) still prevents a double send.

## 9. Rate limiting, delay, and concurrency

### 9.1 Configuration (environment variables, no hardcoding)

| Variable | Default | Meaning |
|---|---|---|
| `WORKER_CONCURRENCY` | `5` | Parallel jobs per worker process |
| `MIN_SEND_GAP_MS` | `2000` | Minimum gap between two sends **from the same sender**, across all workers |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` | Hard cap per sender per UTC hour |
| `GLOBAL_LIMITER_MAX` / `GLOBAL_LIMITER_DURATION_MS` | `10` / `1000` | BullMQ queue-wide limiter, an extra safety net for the SMTP provider |
| `SEND_LEASE_MS` | `120000` | How long a `sending` claim is trusted before it counts as interrupted (§7.2) |
| `START_GRACE_MS` | `300000` | How far in the past `startAt` may be (§5) |
| Campaign `hourlyLimit` | from the form | Campaign-wide emails per hour. It is applied when the plan is made (`intervalMs`, §7.1) and checked again at runtime as a safety net, which matters for catch-up after downtime. It is **not** clamped to the sender capacity. Any overflow beyond what the senders can handle is deferred, and that is how the rate-limit demo works. |

### 9.2 Atomic slot reservation (`lua/reserve_send.lua`)

The script hands each job its **own send slot** for the sender: `slot = max(now, nextAllowed)`. It then moves the pointer forward by the minimum gap. The hourly counters are charged against the UTC hour **of the slot**, not of `now`.

| Key | Purpose |
|---|---|
| `gap:s:{senderId}` (`KEYS[1]`) | The sender's next free slot (ms) |
| `rl:s:{senderId}:{hourIndex}` | Sender hourly counter (`hourIndex = floor(ms / 3_600_000)`) |
| `rl:c:{campaignId}:{hourIndex}` | Campaign hourly counter |

The counter keys depend on the slot, so the script builds them itself. That is fine on our single-node Redis, but it would need hash tags on a Redis Cluster.

```lua
-- ARGV: nowMs, senderId, campaignId, senderLimit, campaignLimit, minGapMs, ttlSec
local now, minGap, ttl = tonumber(ARGV[1]), tonumber(ARGV[6]), tonumber(ARGV[7])
local senderLimit, campaignLimit = tonumber(ARGV[4]), tonumber(ARGV[5])

local nextAllowed = tonumber(redis.call('GET', KEYS[1]) or '0')
local slot = math.max(now, nextAllowed)
local hour = math.floor(slot / 3600000)
local sKey = 'rl:s:' .. ARGV[2] .. ':' .. hour
local cKey = 'rl:c:' .. ARGV[3] .. ':' .. hour

if tonumber(redis.call('GET', sKey) or '0') >= senderLimit then return {'LIMIT', 'sender', hour} end
if tonumber(redis.call('GET', cKey) or '0') >= campaignLimit then return {'LIMIT', 'campaign', hour} end

local keyTtl = ttl + math.ceil((slot - now) / 1000)
redis.call('INCR', sKey); redis.call('EXPIRE', sKey, keyTtl)
redis.call('INCR', cKey); redis.call('EXPIRE', cKey, keyTtl)
redis.call('SET', KEYS[1], slot + minGap, 'PX', (slot - now) + minGap * 10)
return {'OK', slot}
```

Because the whole check-and-increment runs as one Lua script, it is atomic in Redis. Any number of workers or instances share the same counters, and nothing is held in memory.

**Why slots instead of "wait and retry":** after a restart (or when a burst becomes due at once), N jobs for one sender each get a distinct slot spaced `minGap` apart, and each wakes exactly once. A plain "wait `nextAllowed − now`" would wake all N together, let one through, and send the other N−1 back to wait again, for roughly N²/2 wasted cycles.

**Edge case:** if the claim or send fails after a successful reservation, the slot and counter stay used. This conservatively under-sends and never over-sends. That trade-off is documented.

### 9.3 Deferral (order-preserving)

When the result is `LIMIT`:

1. `nextWindowStart = (hour + 1) × 3_600_000`, using the `hour` the script returned (the slot's window).
2. Take an ordered position in that window: `pos = INCR defer:{scope}:{scopeId}:{hour + 1}`, with a 2-hour TTL.
3. `newTime = nextWindowStart + (pos − 1) × spacing`. `spacing` is `MIN_SEND_GAP_MS` for the `sender` scope and `campaign.interval_ms` for the `campaign` scope. Collisions with emails already planned for that window are fine, because the slot reservation (§9.2) spaces them out anyway.
4. Update the row: `status='deferred'`, `next_attempt_at=newTime`, `defer_scope`, `defer_limit`. Clear `job.data.slotAt`.
5. Call `job.moveToDelayed(newTime, token)` and throw `DelayedError`. Attempts are **not** consumed, and the job is never failed.
6. **Audit:** insert a `rate_limit_events` row the first time each `(scope, scopeId, window)` is hit (guarded by the same `SET … NX` pattern).
7. **Notify (sender scope only):** `SET slack:notified:{userId}:{senderId}:{hour} 1 NX EX 7200`. Only if that succeeds, enqueue a job on the `notifications` queue with `{ userId, senderId, hour }`. Hitting a campaign limit doesn't page anyone, because it is the user's own pacing working as configured.

Jobs reach the limit in roughly their planned order (BullMQ promotes delayed jobs by timestamp; with concurrency > 1, jobs due within the same few milliseconds may swap). The positions keep that order in the next window. If the next window also overflows, the same logic pushes the job forward again.

### 9.4 Concurrency safety

- **Database claim** (`update … where status in (…) returning`): no two workers can send the same email.
- **`jobId = emailId`:** BullMQ will not hold two jobs for one email.
- **Lua reservation:** the counters and the gap cannot race.
- **Separate transports per sender,** pooled (`pool: true, maxConnections: 2`).

### 9.5 Behavior under load: 1,000+ emails at the same instant

Example: a campaign starting at 14:00 UTC with 1,000 recipients, 3 senders, `delay=2s`, `hourlyLimit=1000`, `MAX_EMAILS_PER_HOUR_PER_SENDER=200`, `MIN_SEND_GAP_MS=2000`, and concurrency 5.

1. `intervalMs = max(2000, 3600) = 3.6 s`. The API inserts 1,000 rows and enqueues 1,000 delayed jobs (2 `addBulk` calls) in about 1 second.
2. The planned times run from 14:00:00 to 14:59:56. Each sender gets about 333 emails, 10.8 s apart. That is more than its cap of 200 per hour, and the Compose dialog warned about it.
3. The worker runs up to 5 jobs in parallel. Slot reservation keeps each sender at least 2 s apart, and the global limiter caps the total rate.
4. At about 14:36 each sender reaches 200. Every job after that gets `LIMIT sender` and is deferred to 15:00 in order. **One Slack alert per sender** goes out ("~133 emails moved to 3:00 PM UTC").
5. From 15:00, the roughly 133 deferred emails per sender go out 2 s apart. Everything is sent by about 15:04:30, with no drops, no duplicates, and no failures caused by limits. `estimateFinish()` predicts the same time, because it simulates these exact rules.

**Catch-up after downtime:** if the worker was down at 14:10–14:20, about 167 overdue jobs are promoted at once when it returns. Each gets its own slot, so each sender drains its backlog at one email per 2 s. The campaign counter caps the burst at `hourlyLimit` for that hour, and any surplus is deferred like any other overflow.

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
   - Otherwise, count the affected emails at that moment: this user's rows on that sender with status in (`scheduled`, `deferred`) and `next_attempt_at < nextWindowStart` (still due this hour, so they will be deferred), plus rows already deferred into the next window. Then POST a Block Kit message to the webhook in the copy from design.md §11: _"⚠️ Sender A hit its hourly limit (200/200). ~37 emails moved to 3:00 PM UTC."_ The count is approximate by nature, because the alert fires on the *first* limit hit, while the rest of the hour is still running.
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

- **Writes:** every write is a **full-document `index`**, built from the current Postgres row, with `version_type: external` and `version = emails.version`. That includes the bulk write at campaign creation and every status change from the worker. Elasticsearch rejects any write older than the stored version with a `409`, which we ignore. This means a slow creation bulk can never overwrite a newer `sent` status, and a worker update never fails with "document missing". The document ID is the email ID, so writes are idempotent.
- **Hosting:** self-hosted Elasticsearch 8 (single node, `xpack.security.enabled=false`, bound to the Docker network only, heap `-Xms1g -Xmx1g`) in the VM's compose stack. Free managed options were rejected: Elastic Cloud is a 14-day trial, and Bonsai's free sandbox runs Elasticsearch 7.10, which the v8 `@elastic/elasticsearch` client refuses to talk to.
- **Query:** a `bool` query with `filter: [term userId, terms status?]` and `must: multi_match(q, [recipient^3, subject^2, body])`, plus highlighting. Pagination uses `search_after`.
- **Reindex:** `scripts/reindex.ts` streams from Postgres into a new index version and swaps the alias.

## 12. Security

- **JWT:** verified with `jose.createRemoteJWKSet(${SUPABASE_URL}/auth/v1/.well-known/jwks.json)`, checking `aud=authenticated` and `iss=${SUPABASE_URL}/auth/v1`. `req.user = { id, email, fullName, avatarUrl }`. This requires the project to use **asymmetric JWT signing keys**, which is the default for projects created since late 2025. In M0, confirm under *Project Settings → JWT Keys* that the JWKS endpoint returns at least one key. If it returns an empty `keys` array, the project is still on the legacy shared secret and must be migrated before any API call will authenticate.
- **Authorization:** every query filters by `user_id = req.user.id`. Elasticsearch queries are always filtered by `userId`.
- **Secrets:** SMTP passwords and Slack tokens are encrypted with AES-256-GCM using `ENCRYPTION_KEY` (32 bytes, base64).
- **HTTP:** `helmet`, CORS restricted to `WEB_URL`, a 1 MB JSON limit, and `express-rate-limit` on `POST /api/campaigns` (10 requests per minute per user).
- **Bull Board:** basic auth using `BULL_BOARD_USER` and `BULL_BOARD_PASS`.
- **Slack OAuth:** the signed, expiring `state` protects against CSRF.

## 13. Environments and deployment

### 13.1 Local

```bash
docker compose up -d                  # redis (AOF, noeviction) + elasticsearch (single-node, security off)
pnpm i
pnpm --filter api db:migrate
pnpm --filter api seed:senders        # creates 3 Ethereal accounts via nodemailer.createTestAccount()
pnpm dev                              # turbo: web :3000, api :4000, worker
```

### 13.2 Hosted (all free tiers)

This is a single-user product demo, so the hosting goal is **$0 per month**. The hard requirement that drives the choice is that **the worker must make outbound SMTP connections on port 587 to Ethereal (C4) and run as a long-lived process (BullMQ)**:

- **Vercel** can't run the API or worker. Functions are short-lived and can't hold a BullMQ worker. It is perfect for the Next.js app.
- **Render's free tier** blocks outbound SMTP ports 25, 465 and 587 (since September 2025), and its free services sleep when idle.
- **Railway** allows outbound SMTP only on Pro, and Hobby has no free tier.
- **Koyeb's free tier** requires a card, scales to zero, and offers one web service only (no worker type).
- **Upstash Redis free** (500K commands per month) would be used up by an idle BullMQ worker's polling and stalled-job checks.

| Piece | Host | Notes |
|---|---|---|
| Web | **Vercel Hobby** | Monorepo root directory `apps/web`. Hobby is non-commercial, which suits a demo. |
| API, worker, Redis, Elasticsearch | **Oracle Cloud Always Free** Ampere A1 VM (up to 4 OCPU / 24 GB RAM, arm64) running `deploy/docker-compose.prod.yml` | Two services from the same image (`start:api`, `start:worker`), Redis 7 with AOF and `noeviction`, Elasticsearch 8. All images have arm64 builds. Only Caddy's ports 80 and 443 are open in the VCN security list. |
| HTTPS for the API | **Caddy** + a free **DuckDNS** subdomain (e.g. `cadence-api.duckdns.org`) | Automatic Let's Encrypt certificates. HTTPS is required: the Vercel site can't call a plain-HTTP API (mixed content), and Slack requires an HTTPS redirect URL. |
| Postgres and Auth | **Supabase Free** | Use the **session pooler** connection string (IPv4, port 5432). The direct connection is IPv6-only. Free projects pause after 7 days without activity, so open the app before a demo. |
| SMTP | **Ethereal** | Free. |
| OAuth | Google Cloud (free), Slack app (free) | Google allows the Supabase callback. Supabase allows the Vercel URL. The Slack redirect points to `https://<duckdns>/api/integrations/slack/callback`. |

**Day-one checks (M0), before writing app code:**

1. From the VM, run `nc -zv smtp.ethereal.email 587`. Oracle blocks port 25 by default, and 587 is expected to work, but verify it.
2. Confirm that the Supabase JWKS endpoint returns keys (§12).
3. Oracle needs a card for identity verification (it is not charged on Always Free). Ampere capacity can be "out of host capacity" in busy regions, so try another availability domain or retry later.

**Fallback (no Oracle account):** run `deploy/docker-compose.prod.yml` on your own machine during the demo, with Caddy replaced by an **ngrok** free static domain as the public HTTPS URL. Everything else is unchanged. The downside is that the backend is only up while your machine is.

### 13.3 `.env.example`

```bash
# api
PORT=4000
WEB_URL=http://localhost:3000                  # prod: https://<project>.vercel.app
DATABASE_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres  # session pooler
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
SEND_LEASE_MS=120000
START_GRACE_MS=300000
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_REDIRECT_URI=http://localhost:4000/api/integrations/slack/callback  # prod: https://<duckdns>/api/...
BULL_BOARD_USER=admin
BULL_BOARD_PASS=change-me
# deploy (VM only)
API_DOMAIN=cadence-api.duckdns.org
DUCKDNS_TOKEN=
# web
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=           # or the legacy anon key
NEXT_PUBLIC_API_URL=http://localhost:4000       # prod: https://cadence-api.duckdns.org
```

## 14. Testing strategy

| Level | What |
|---|---|
| Unit | CSV parser (dedupe, header detection, invalid entries). `intervalMs` and schedule math. `estimateFinish()` against the §9.5 example. Start-time grace. Window index and next-window computation. SMTP error classification (retryable, ambiguous, or permanent). Encryption round-trip. |
| Integration (Redis testcontainer) | Lua reservation under 50 parallel calls never exceeds the limit, and it hands out distinct slots at least `minGap` apart. Deferral positions are monotonic. Duplicate `addBulk` with the same job ID produces one job. The reconciler replaces a stale `failed` job and re-adds a missing one. |
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
