# Cadence — Product Requirements Document

> **Cadence** is a reliable, rate-aware email scheduler with a clean dashboard.
> Schedule thousands of emails, send them at the right pace, and never send one twice.

| | |
|---|---|
| **Project** | Cadence (repo: `cadence`) |
| **Category** | Email infrastructure: outbound scheduling and delivery |
| **Author** | _you_ |
| **Status** | Draft v1 |
| **Timebox** | 48 hours |
| **Companion docs** | [`tech-spec.md`](./tech-spec.md) · [`design.md`](./design.md) |

---

## 1. Problem

Cold-outreach teams must send large volumes of email **at a precise time**, **at a safe pace**, and **exactly once**. Every email provider throttles senders, and going over the limit gets a domain flagged.

The infrastructure also has to survive crashes and deploys without losing or duplicating mail.

Cadence solves this with two pieces:

- an API and worker that schedule and send email through a persistent queue
- a dashboard where a user composes a campaign and watches it go out

## 2. Goals

1. **Correct scheduling.** Every email is sent at or after its scheduled time, never before.
2. **Exactly-once delivery from the user's point of view.** No duplicates, even across restarts, retries, or multiple workers.
3. **Durability.** A server restart never loses a job and never resets the schedule.
4. **Provider-safe throughput.** The system enforces configurable concurrency, a minimum gap between sends, and hourly caps. Overflow is deferred, never dropped.
5. **Observability.** The live queue dashboard, searchable email history, and Slack alerts when limits are hit together make system behavior visible.
6. **A professional, minimal UI** that people enjoy using.

## 3. Non-goals

- Bulk sending infrastructure of our own (SMTP relays, IP warm-up, deliverability tooling). Mail goes out through each user's own Gmail account, within Gmail's limits.
- Email templating, open and click tracking, reply detection, and lead enrichment.
- Multi-tenant organizations, teams, or roles. One user is one tenant.
- Billing.
- Rich-text or HTML email editing. The body is plain text.

## 4. Users

| Persona | Need |
|---|---|
| **Growth marketer** (primary) | Upload a lead list, write a message, pick a start time and pace, and trust it to go out correctly. |
| **Operator / engineer** | Check queue health, persistence, rate limiting, and idempotency quickly through Bull Board, logs, and the docs. |

## 5. Hard constraints

These are non-negotiable and any design that violates them is wrong.

| # | Constraint |
|---|---|
| C1 | Backend in **TypeScript + Express.js** |
| C2 | Queue is **BullMQ on Redis** |
| C3 | Database is **PostgreSQL** (we use **Supabase** Postgres). **MongoDB is not allowed.** |
| C4 | Email is sent through each user's **own connected Gmail account** (Gmail API, OAuth scope `gmail.send`). Cadence never sends from an address the user hasn't connected. |
| C5 | **No cron**: no crontab, no `node-cron`, no `agenda`, no repeatable jobs used as a cron substitute |
| C6 | Persistent across restarts, with no lost or duplicated emails |
| C7 | Idempotent: the same email is never sent more than once |
| C8 | Frontend in **Next.js + Tailwind + TypeScript** |
| C9 | **Real Google OAuth** (no mock) |
| C10 | **Real Slack OAuth** plus a live Slack message when a sender's hourly limit is hit |
| C11 | Emails are searchable by recipient, subject, and message, with **Postgres full-text and trigram search** (no separate search service) |
| C12 | **Live BullMQ dashboard** exposed |

## 6. Functional requirements

Priority key: **P0** = must ship in v1. **P1** = should ship (strong signal). **P2** = nice to have.

### 6.1 Authentication

| ID | Requirement | Priority |
|---|---|---|
| AUTH-1 | The user signs in with **Google OAuth**, using Supabase Auth with the Google provider. | P0 |
| AUTH-2 | After sign-in, the user is redirected to `/dashboard`. | P0 |
| AUTH-3 | The header shows the user's **name, email, and avatar**. | P0 |
| AUTH-4 | **Logout** clears the session and returns the user to `/`. | P0 |
| AUTH-5 | Dashboard routes are protected. Unauthenticated users are redirected to `/login`. | P0 |
| AUTH-6 | Every backend API call is authenticated with the Supabase JWT. The backend verifies it and scopes all data to that user. | P0 |

### 6.2 Compose and schedule a campaign

A **campaign** is one compose action. It contains one subject, one body, many recipients, and pacing settings. Each recipient becomes one **email** (one job).

| ID | Requirement | Priority |
|---|---|---|
| CMP-1 | The user can open **Compose New Email** from a primary button. | P0 |
| CMP-2 | Fields: **Subject** (required, at most 200 characters) and **Body** (required, plain text, at most 10,000 characters). | P0 |
| CMP-3 | The user can **upload a CSV or TXT file** of leads, or **type or paste addresses** (separated by new lines, commas, semicolons, or spaces). The file is parsed client-side. The form shows the **count of valid emails detected**, plus counts of duplicates and invalid entries removed. | P0 |
| CMP-4 | **Start time**: date and time in the user's local timezone. It must be now or in the future. The server accepts up to 5 minutes in the past and treats it as "now", so "Send now" and slow requests never fail. "Send now" is a shortcut. | P0 |
| CMP-5 | **Delay between emails** in seconds (minimum 1, default 2, or the user's saved default): the minimum spacing between two emails of this campaign, across all its senders. | P0 |
| CMP-6 | **Hourly limit**: the maximum number of emails per hour for the whole campaign (default 100 or the user's saved default, range 1–3,600). Delay and hourly limit combine into one spacing, `max(delay, 3600 / hourlyLimit)` seconds, which is shown as "1 email every 36 s". If the plan exceeds what the selected senders may send per hour, the form warns that the extra emails will be deferred. | P0 |
| CMP-7 | **Send from**: choose one or more of the user's connected Gmail senders. Recipients are distributed round-robin across the chosen senders. The default is all of them. With no connected sender, Compose explains how to connect one and the server refuses the campaign (`NO_SENDERS`). | P0 |
| CMP-8 | **Schedule** sends the campaign to the backend. On success, the form closes, shows a toast ("1,240 emails scheduled"), and refreshes the Scheduled tab. | P0 |
| CMP-9 | Client-side and server-side validation with inline error messages. | P0 |
| CMP-10 | A preview line shows the estimated finish time. It comes from a shared function that simulates the plan, including deferral at the sender cap, so the preview and the server's `estimatedFinishAt` agree. | P1 |
| CMP-11 | Upload limits: at most 5,000 recipients per campaign and at most 2 MB per file. | P0 |

### 6.3 Scheduled emails

| ID | Requirement | Priority |
|---|---|---|
| SCH-1 | A table with the columns **Email, Subject, Scheduled time, Status**. | P0 |
| SCH-2 | Includes the statuses `scheduled`, `deferred` (pushed back by the rate limit), and `sending`. | P0 |
| SCH-3 | Sorted by scheduled time, ascending. | P0 |
| SCH-4 | **Loading** skeleton and an **empty state** with a Compose call to action. | P0 |
| SCH-5 | Paginated (cursor-based, 25 rows per page). | P0 |
| SCH-6 | Automatically refreshes every 5 seconds while the tab is visible. | P1 |
| SCH-7 | Deferred rows show a tooltip explaining why, using the design.md copy ("Sender B reached 200/hour. Moved to 4:00 PM."). | P1 |
| SCH-8 | The user can cancel a scheduled email. | P2 |

### 6.4 Sent emails

| ID | Requirement | Priority |
|---|---|---|
| SNT-1 | A table with the columns **Email, Subject, Sent time, Status** (`sent` or `failed`). | P0 |
| SNT-2 | Sorted by sent time, descending. | P0 |
| SNT-3 | **Loading** and **empty** states. | P0 |
| SNT-4 | A **View** link opens the sent message in the sender's Gmail. | P1 |
| SNT-5 | Failed rows show the error reason. | P1 |

### 6.5 Search (Postgres)

| ID | Requirement | Priority |
|---|---|---|
| SRC-1 | Search reads Postgres directly, so results always match the latest status. There is no separate index to keep in sync or rebuild. | P0 |
| SRC-2 | A search bar in the dashboard supports full-text search over recipient, subject, and body, filtered by status. Part of an address finds it ("acme" finds jane@acme.com). Matches are highlighted. | P0 |
| SRC-3 | Search results are scoped to the signed-in user. | P0 |

### 6.6 Scheduler and delivery

| ID | Requirement | Priority |
|---|---|---|
| SCD-1 | Each email is a **BullMQ delayed job** whose delay is computed from its `scheduled_at`. No cron. | P0 |
| SCD-2 | Emails are sent through the **Gmail API** from the user's **connected Gmail accounts** (one or more). | P0 |
| SCD-3 | **Persistence.** Jobs survive restarts of the API, the worker, and Redis (with Redis AOF on). When the API or the worker boots, a reconciler re-enqueues any `scheduled` or `deferred` email that has no live job in Redis, and marks emails stuck in `sending` past their lease as `failed` (`interrupted`). | P0 |
| SCD-4 | **Idempotency.** The job ID equals the email ID, sends are claimed in the database with an atomic status transition, and the send happens only after a successful claim. | P0 |
| SCD-5 | Send errors where Gmail **certainly did not accept** the message (token refresh failures, a refused connection, `401`, `429`, and Gmail rate-limit `403`s) are retried up to 3 times with exponential backoff. Errors where it may have been accepted (`5xx`, timeouts, a connection dropped mid-request) are **not** retried; the email is marked `failed`, so it can't be duplicated. Permanent failures (bad request, revoked access) are marked `failed` with a reason. | P0 |
| SCD-6 | The send time, the Gmail message ID, and a link to the message in Gmail are stored. | P0 |
| SCD-7 | If a sender is disconnected or its Google access is revoked, its pending emails are marked `failed` ("sender disconnected") when their time comes, never sent from another account. | P0 |

### 6.7 Throughput, rate limiting, and concurrency

| ID | Requirement | Priority |
|---|---|---|
| RL-1 | The worker's **concurrency** is configurable through `WORKER_CONCURRENCY` (default 5). | P0 |
| RL-2 | A **minimum gap between sends per sender**, configured through `MIN_SEND_GAP_MS` (default 2000 ms), is enforced with Redis so it holds across workers. Each waiting job reserves its own future slot, so a backlog drains smoothly instead of colliding. | P0 |
| RL-3 | A **per-sender hourly cap** that the user sets for each sender (default 20, at most the server maximum `MAX_EMAILS_PER_HOUR_PER_SENDER`, default 200), using Redis counters keyed by `sender + hour window`. It is shared by all of that sender's campaigns. | P0 |
| RL-4 | The **campaign hourly limit** is applied when the campaign is planned (by the email spacing), so a campaign never has to be deferred to respect its own limit. It is also checked at runtime as a safety net, for example when catching up after downtime. | P0 |
| RL-5 | When a limit is hit, the job is **deferred to the next hour window** (status `deferred`) in its **planned order** (best effort; jobs due within the same few milliseconds may swap). Jobs are never dropped or failed because of a limit. | P0 |
| RL-6 | All limit checks are **atomic** (Redis Lua scripts) and safe with multiple worker processes. | P0 |
| RL-7 | Defined behavior for **1,000+ emails at the same instant**. See tech-spec §9. | P0 |
| RL-8 | A load-test script schedules N emails to demonstrate the behavior. | P1 |

### 6.8 Slack notifications

| ID | Requirement | Priority |
|---|---|---|
| SLK-1 | The settings page has a **Connect Slack** button that starts the real Slack OAuth v2 flow. | P0 |
| SLK-2 | The backend exchanges the code and stores the incoming-webhook URL and access token per user, encrypted at rest. | P0 |
| SLK-3 | The moment a sender's hourly limit is reached, a **real Slack message** is posted. At most one message is sent per sender per hour window. Campaign-limit hits are only recorded in the audit log, because they are the user's own pacing working as configured. | P0 |
| SLK-4 | If Slack is not connected, nothing is sent and nothing crashes. | P0 |
| SLK-5 | The user can **disconnect** and **reconnect** without a redeploy. The next limit hit uses the current state. | P0 |
| SLK-6 | A **Send test message** button is available. | P1 |
| SLK-7 | Slack failures never block or fail email sending, because notifications go through a separate queue. | P0 |

### 6.9 Queue dashboard

| ID | Requirement | Priority |
|---|---|---|
| QD-1 | **Bull Board** is mounted at `/admin/queues` on the API and shows live jobs, delays, failures, and retries. | P0 |
| QD-2 | It is protected with HTTP basic auth, using credentials from the environment. | P0 |
| QD-3 | It is an **operator** tool: it shows every user's jobs and has raw controls (retry, promote, delete) that bypass pacing, so the product UI never links to it. Users see their own emails on the Scheduled and Sent pages instead. | P0 |

### 6.10 Senders and settings

| ID | Requirement | Priority |
|---|---|---|
| SET-1 | Settings has a **Connect Gmail** button that starts Google OAuth with the `gmail.send` scope (plus `openid email profile` to learn the address). The refresh token is stored encrypted, per user. Connecting the same address again refreshes its access instead of adding a duplicate. | P0 |
| SET-1a | **Signing in connects Gmail too.** "Continue with Google" (run by Cadence itself, so Google's screens name Cadence rather than the Supabase project) also asks for `gmail.send` with offline access, so the Gmail account a user signs in with becomes a sender with no extra step. If they untick the Gmail box, sign-in still succeeds and no sender is added. A sender the user disconnected is never reconnected by a later sign-in; only Connect Gmail brings it back. | P0 |
| SET-2 | If the user unticks the Gmail permission on Google's consent screen, nothing is saved and Settings explains that Cadence needs it to send. | P0 |
| SET-3 | Each sender shows its address, a **label** and a **display name** (the name recipients see), its **hourly limit**, and this hour's usage. All three are editable. | P0 |
| SET-4 | **Disconnect** revokes the token at Google and deactivates the sender. Past emails keep their history. | P0 |
| SET-5 | A sender whose Google access stops working (revoked, password changed) is marked **Reconnect needed** and is not offered in Compose until reconnected. | P0 |
| SET-6 | **Campaign defaults**: the user saves a default delay and hourly limit, which Compose pre-fills. | P1 |
| SET-7 | Server-wide limits (minimum gap, the per-sender maximum, worker concurrency, recipients per campaign) are shown read-only. | P2 |

### 6.11 Dashboard overview

| ID | Requirement | Priority |
|---|---|---|
| OV-1 | A **pace strip** (a timeline of planned and finished sends per sender, with hour windows and cap usage) and readouts for **Next send, Finishes around, Deferred, and Failed**. See design.md §7.1–7.2. | P1 |
| OV-2 | A per-sender usage meter for the current hour on the Settings page (for example, "142 of 200 this hour"). | P2 |

## 7. Pages (summary)

Full details are in tech-spec §6 and design.md §8.

| Route | Purpose | Auth |
|---|---|---|
| `/` | Landing page: hero, how it works, features, sign-in call to action | Public |
| `/login` | Sign in with Google | Public |
| `/auth/google`, `/auth/google/callback` | Cadence's own Google sign-in and Connect Gmail flow | Public |
| `/dashboard` | Redirects to `/dashboard/scheduled` | Private |
| `/dashboard/scheduled` | Pace strip, readouts, and the scheduled emails table grouped by hour | Private |
| `/dashboard/sent` | Sent emails table | Private |
| `/dashboard/search` | Search results (Postgres full-text and trigram search) | Private |
| `/dashboard/settings` | Gmail senders (connect, edit, disconnect), campaign defaults, Slack, and server limits (read-only) | Private |
| _Compose panel_ | Side panel with a live preview, opens over any dashboard page (`?compose=1`) | Private |

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| **Reliability** | Zero duplicate sends in restart and kill tests. Zero lost jobs after restarting the API, the worker, or Redis. |
| **Accuracy** | An email is never sent before `scheduled_at`. Under normal load it goes out within 5 seconds of its eligible time (excluding deliberate deferral). |
| **Scale** | Accepts a 5,000-recipient campaign in under 3 seconds, using batched database inserts and BullMQ `addBulk`. |
| **Security** | JWTs are verified through JWKS. Every query is scoped by `user_id`. Gmail refresh tokens and Slack secrets are encrypted with AES-256-GCM. Google user data is used only to send the user's own campaigns (Google API Services User Data Policy, Limited Use). Requests are validated with Zod. Bull Board is behind auth. Secrets are never committed. |
| **Performance** | Dashboard tables load in under 500 ms (p95) for 10,000 rows, using indexed cursor pagination. |
| **Accessibility** | WCAG 2.1 AA contrast, full keyboard navigation, and visible focus rings. |
| **Code quality** | Strict TypeScript, shared Zod schemas between front and back end, ESLint and Prettier, and unit tests for the rate limiter and scheduling math. |
| **Ops** | Health endpoint, structured logs (pino), graceful shutdown (draining the worker before exit), and Docker Compose for both local infrastructure and the production VM. |
| **Cost** | $0 per month. Every hosted piece runs on a free tier (tech-spec §13.2). |

## 9. Acceptance criteria

1. A user signs in with Google and the header shows their name, email, and avatar.
1a. The Gmail account they signed in with already appears in Settings as a sender, with its address and an hourly limit of 20. They can connect more with Connect Gmail.
2. Uploading a CSV shows the detected count. The user schedules emails a couple of minutes in the future, and they appear in **Scheduled**.
3. They move to **Sent** on time, the messages arrive in the recipients' inboxes, and the View link opens each one in the sender's Gmail.
4. **Restart test:** stop the API and worker, wait until past a scheduled time, start them again. The overdue emails send immediately, exactly once, and future emails keep their times.
5. **Rate limit:** with a low cap (set the sender's hourly limit to 5 in Settings), schedule 30 emails with "Send now", a 2 s delay and an hourly limit of 3,600, so the caps are hit within about a minute. Extra emails show `deferred` with next-hour times, and **a Slack message arrives live**.
6. Disconnect Slack and trigger the limit again: there is no message and no crash. Reconnect and it works again.
7. Bull Board shows delayed, active, and completed jobs live.
8. Search finds emails by recipient or subject.

## 10. Assumptions and trade-offs

- **The hour window is a fixed UTC clock hour** (for example, 14:00–14:59), not a sliding window. This is simpler and easy to reason about and test. The trade-off is a possible burst of up to 2× the cap around a window boundary, which is acceptable for this scope.
- **At-most-once on crash during a send.** If a worker dies after Gmail accepted a message but before the database was updated, the email is marked `failed` (reason: `interrupted`) instead of being retried. We prefer a rare missed send over a duplicate, because for outreach a duplicate email does more damage than a missed one.
- **Senders are per user.** Each user connects their own Gmail accounts; nobody can send from another user's sender, and each sender's hourly cap counts only its owner's campaigns. Gmail allows about 500 recipients a day on a personal account (2,000 on Workspace), so the default per-sender limit is 20 an hour.
- **Google verification.** `gmail.send` is a sensitive scope. Until Google verifies the app, users see an "unverified app" screen and the app is limited to 100 users. Verification needs the privacy policy (`/privacy`) and a short demo video.
- **No SMTP.** The Gmail API is HTTPS, so hosts that block outbound SMTP no longer matter for sending.
- **One user is one tenant.** Slack connections and campaigns belong to a user.
- **Campaign pacing is planned and sender caps are enforced.** A campaign's own delay and hourly limit decide its planned send times. Deferral exists for the shared per-sender cap, so the Scheduled tab shows real times rather than mostly `deferred` rows.
- **Deployment is free-tier only:** the web app runs on Vercel Hobby. The API, worker, and Redis run with Docker Compose on an Oracle Cloud Always Free VM, behind Caddy with HTTPS. Postgres and Auth are on Supabase Free. The VM keeps Redis on the free tier. See tech-spec §13.2.
- **design.md is the source of truth** for the UI: tokens, components, and page layouts.

## 11. Milestones (48 hours)

| # | Window | Deliverable |
|---|---|---|
| M0 | 0–2 h | Monorepo scaffold, Docker Compose (Redis), Supabase project (confirm JWKS returns keys), Google provider, env templates. Provision the Oracle VM. |
| M1 | 2–10 h | Database schema and migrations, campaign API, scheduler (enqueue), worker (send through the Gmail API), idempotent claims |
| M2 | 10–16 h | Rate limiter (Lua), minimum gap, deferral logic, startup reconciler, restart tests |
| M3 | 16–26 h | Next.js landing, login, dashboard, compose, and tables, wired to the API |
| M4 | 26–32 h | Slack OAuth, notifications queue, and settings page |
| M5 | 32–37 h | Postgres search, search UI, and Bull Board |
| M6 | 37–43 h | Polish (empty, loading, and error states), tests, load script, deployment (Vercel + VM compose + Caddy/DuckDNS) |
| M7 | 43–48 h | README, architecture diagram, walkthrough video, launch |

## 12. Open questions

1. Should the hourly window become a sliding window in v2 to remove boundary bursts?
2. Do we need team workspaces (multi-user tenants) after v1?
3. ~~Should the hourly limit be global or per sender?~~ **Decided:** the campaign limit is campaign-wide and applied when planning, and the sender cap is per sender and enforced at runtime (RL-3, RL-4).
4. ~~Should senders become per-user, so that users don't share caps?~~ **Decided:** yes. Senders are the user's own Gmail accounts (§6.10).
