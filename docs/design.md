# Cadence — Design Language

> **Quiet, precise, trustworthy.** Cadence is a schedule being kept. The UI borrows from the things people already trust to keep time — railway timetables, departure boards, metronomes: time is the primary axis, figures are exact and aligned, and only what is off-schedule draws the eye.

| | |
|---|---|
| **Companion docs** | [`prd.md`](./prd.md), [`tech-spec.md`](./tech-spec.md) |
| **Direction** | "The timetable" (v2 of this document; replaces the earlier zinc/cobalt/Geist direction) |

---

## 1. Principles

1. **Time is the primary axis.** Times come first in every list, set in tabular figures and left-aligned like a timetable. Lists of emails are grouped by the hour windows the rate limiter actually uses.
2. **Color marks exceptions.** The normal states (scheduled, sent) are neutral. Color appears only for something that needs attention (deferred, failed) or is happening right now (sending). If a screen is calm, everything is on time.
3. **Show the mechanism.** Hour windows, sender caps, and deferral are drawn, not hidden in tooltips. Seeing how the system works is what makes it trustworthy.
4. **One bold element.** The pace strip (§7.1) is the product's signature. Everything around it stays quiet: no decorative gradients, no glow, no dot grids, no card-on-card layouts.
5. **Contrast is not optional.** Every text pair meets WCAG AA (4.5:1 body, 3:1 large text). Control boundaries meet 3:1 (WCAG 1.4.11). Primary text targets AAA.
6. **Calm motion.** Transitions are 150–200 ms ease-out and explain a change. There is exactly one orchestrated moment in the product: the landing-page strip, which plays once.
7. **Precise copy.** Numbers are formatted, times carry their timezone, and nothing says "Something went wrong" without saying what.

## 2. Brand

- **Name:** Cadence. Capitalized in prose. The wordmark is lowercase: `cadence`.
- **Mark:** four evenly spaced vertical ticks on a shared baseline, a miniature of the pace strip. On a 20×20 grid: ticks 2 px wide, 12 px tall, at x = 3, 7, 11, 15, baseline at y = 16, square ends. The first three are `--ink`; the fourth, "the next send", is `--signal`. The monochrome variant is all `--ink`.
- **Wordmark:** Instrument Sans, weight 600, normal width, letter-spacing −0.01em.
- **Lockup:** mark, 8 px gap, wordmark. Minimum height 20 px.
- **Favicon:** four white ticks on a `--signal` square with a 4 px radius.

## 3. Color

All colors are CSS variables on `:root`, remapped under `prefers-color-scheme: dark` (unless `data-theme="light"`) and under `[data-theme="dark"]`. **Light is the default:** the root element sets `data-theme="light"`, so the app stays light regardless of the OS setting; the dark values are kept for a future theme switch. Tailwind v4 exposes them through `@theme` (§12). The neutrals lean slightly green-grey so they sit in harmony with the teal accent; none of them are stock Tailwind values.

### 3.1 Neutrals and accent

| Token | Light | Dark | Use | Contrast (on `surface`, light / dark) |
|---|---|---|---|---|
| `--canvas` | `#F3F4F2` | `#0F1211` | Page background | |
| `--surface` | `#FFFFFF` | `#151918` | Tables, panels, header | |
| `--sunken` | `#EBEDEA` | `#1B201E` | Table header row, hour-group rows, hover, strip track | |
| `--line` | `#DCE0DC` | `#262C2A` | Hairline dividers (1 px). Decorative only, never a control boundary. | |
| `--control` | `#858E89` | `#66706B` | Input, checkbox, and secondary-button borders | 3.4:1 / 3.5:1 |
| `--ink` | `#141817` | `#ECEFED` | Primary text, sent marks | 17.9:1 / 15.3:1 |
| `--ink-2` | `#48514E` | `#A9B2AE` | Secondary text, labels, column headers | 8.2:1 / 8.2:1 |
| `--ink-3` | `#66706C` | `#87918D` | Captions, placeholders, scheduled marks | 5.1:1 / 5.5:1 |
| `--signal` | `#0B6E69` | `#4CC2B8` | The accent: primary buttons, links, active nav, focus, "sending", the now-line | 6.1:1 / 8.2:1 |
| `--signal-hover` | `#085854` | `#6FD3CA` | Hover on signal surfaces | |
| `--signal-fg` | `#FFFFFF` | `#06201E` | Text on `--signal` | 6.1:1 / 7.9:1 |
| `--signal-soft` | `#E3F1EF` | `#12302D` | Selected rows, search-match highlight, new-row flash | signal text on it: 5.3:1 / 6.5:1 |

**Why teal:** it reads as a signal light or an instrument trace, it is not the default SaaS blue, and it stays clear of the amber and red that carry exceptions. Green is not a status color in this system, so there is no confusion with "success".

**Rules:**
- `--signal` is the only accent. It never decorates, and there is one primary (signal-filled) button per view.
- Body copy is never set in `--signal`. Links are `--signal` with an underline on hover and focus.
- `--ink-3` text on `--sunken` is allowed only at 13 px and up (4.35:1 light).

### 3.2 Exception colors

| Token | Light | Dark | Use |
|---|---|---|---|
| `--deferred` | `#8A5300` | `#E8A33D` | Deferred status text, capacity warnings (6.3:1 / 8.2:1) |
| `--deferred-mark` | `#C77A00` | `#E8A33D` | Deferred ticks and full usage meters (3.4:1 light, non-text) |
| `--deferred-soft` | `#FBF1E1` | `#2A1F0C` | Background of a full hour-window cell in the pace strip |
| `--failed` | `#B42318` | `#F07167` | Failed status, errors, destructive buttons (6.6:1 / 6.1:1) |
| `--failed-soft` | `#FCEBE9` | `#2E1412` | Error banner background |

There is no separate "warning" or "success" color. A success toast uses `--ink` with a check glyph; warnings about capacity use `--deferred`, because a capacity warning *is* a prediction of deferral.

### 3.3 Status marks

Statuses are shown as a small glyph plus a text label, with **no pill background**. Glyphs are 10 px inline SVGs (not Unicode characters, so they render identically everywhere), `aria-hidden`, always followed by the visible label.

| Status | Glyph | Glyph and label color | Notes |
|---|---|---|---|
| `scheduled` | Hollow circle | `--ink-3` | The normal waiting state. Quiet on purpose. |
| `sending` | Half-filled circle | `--signal` | Slow 2 s opacity pulse (static under reduced motion) |
| `deferred` | Curved arrow (↷) | `--deferred` | Time column shows the original time as a caption ("was 3:52 PM"); tooltip has the reason |
| `sent` | Filled circle | `--ink` | |
| `failed` | Cross | `--failed` | The reason is written in the row, not hidden in a tooltip |
| `cancelled` | Dash | `--ink-3` | Label struck through |

## 4. Typography

**One family: Instrument Sans** (SIL OFL, Google Fonts), loaded with `next/font/google` including the `wdth` axis. It has tabular figures (`tnum`) and a width axis from 75 to 100.

- **Normal width (100)** for all interface text.
- **Narrow width (85)** for times and large figures. This is the timetable voice: condensed, tabular, slightly taller-looking numerals. Set with `font-stretch: 85%`.
- **Monospace** (`ui-monospace, SFMono-Regular, Menlo, monospace`, no webfont) only for job IDs, Message-IDs, and code. Email addresses are set in the sans.
- `font-variant-numeric: tabular-nums` on every time, count, and numeric column.

| Token | Size / line height | Weight | Width | Tracking | Use |
|---|---|---|---|---|---|
| `display` | 48 / 52 | 600 | 100 | −0.02em | Landing headline (34/40 below 640 px) |
| `title` | 24 / 30 | 600 | 100 | −0.01em | Page titles, panel titles |
| `section` | 17 / 24 | 600 | 100 | 0 | Section headings, settings groups |
| `body-lg` | 16 / 26 | 400 | 100 | 0 | Landing copy, panel descriptions (max 68 characters per line) |
| `body` | 14 / 20 | 400 | 100 | 0 | Default UI text |
| `label` | 13 / 18 | 500 | 100 | 0 | Form labels, column headers, status labels. Sentence case, never all caps. |
| `caption` | 12 / 16 | 400 | 100 | 0 | Helper text, meta, relative times |
| `readout` | 32 / 36 | 600 | 85 | −0.01em | Readout values (§7.2) |
| `time` | 14 / 20 | 500 | 85 | 0 | The time column in tables |

## 5. Space, shape, and elevation

- **Spacing:** 4 px base. Scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96.
- **Radius by level, not one radius everywhere:**
  - 6 px: controls (buttons, inputs, sender chips, tooltips, menu items).
  - 10 px: panels (the table container, the pace strip container, settings sections, menus).
  - 0 px on any edge attached to the viewport (the compose panel's right edge, the mobile sheet's bottom).
  - Fully round: avatars only.
- **Borders:** 1 px `--line` for structure; 1 px `--control` for anything you can type in or toggle. No double borders: a table inside a panel loses its own outer border.
- **Elevation:** panels sitting on the page have **no shadow**, only a hairline. Exactly one shadow exists, for things that float above the page (menus, popovers, the compose panel, toasts):
  - `--shadow-float`: `0 8px 24px -6px rgb(15 18 17 / 0.16), 0 0 0 1px var(--line)`.
- **Control heights:** 32 px (sm), 36 px (default), 44 px (lg: landing actions, the Google button, all mobile tap targets).
- **Layout:** content max width 1200 px; gutters 24 px desktop, 16 px mobile; header 56 px. Breakpoints `sm 640`, `md 768`, `lg 1024`, `xl 1280`.
- **Nothing decorative:** no decorative gradients, no dot grid, no illustrations, no stock imagery. The one exception is the soft teal glow behind the landing hero's live send queue (§8.1), which gives the page its brand color without a hard shape.

## 6. Iconography

- **lucide-react** at a 1.5 px stroke, 16 px inline and 20 px in buttons. Icons inherit `currentColor` and are never multicolored.
- Status glyphs (§3.3) and the brand mark are custom SVGs, not lucide.
- The only multicolor marks allowed are third-party logos the user must recognize: the Google "G" on the sign-in button and the Slack logo in Settings.
- An external-link icon appears only on links that open a new tab (Ethereal preview, Queue dashboard). Text never ends in arrow characters.

## 7. Components

Built on shadcn/ui and Radix, restyled to these tokens, in `components/ui`. Every interactive element has `hover`, `active`, `focus-visible`, and `disabled` states. Focus is a 2 px `--signal` ring with a 2 px offset in `--canvas`. Disabled is 50% opacity with a `not-allowed` cursor.

### 7.1 Pace strip (signature component)

A horizontal timeline of a campaign's sends. It appears in three places with the same component: the top of the dashboard (live), the compose preview (planned), and the landing hero (scripted demo).

**Anatomy**

```
        now ┃
Sender A  ▏▏▏▏▏▏▏▏▏▏▏▏│▏▏▏▏▏▏▏▏▏▏▏▏▏▏▏▏▏│▏▏▏▏▏▏
          ▔▔▔▔▔▔▔▔▔▔▔▔ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ ▔▔▔▔▔        ← per-window usage bar
Sender B  ▏▏▏▏▏▏▏▏▏▏▏▏│▏▏▏▏▏▏▏▏▏▏▏▏▏▏▏▏▏│▏▏▏▏▏ (amber ticks moved into this window)
Sender C  ▏▏▏▏▏▏▏▏▏▏▏▏│▏▏▏▏▏▏▏▏▏▏▏▏▏▏▏▏▏│▏▏▏
          2 PM         3 PM              4 PM              5 PM
```

- **Container:** `--surface` panel, 10 px radius, 1 px `--line`, 16 px padding. Height is 28 px per lane plus a 24 px time axis (about 108 px for three senders).
- **Lanes:** one per sender, label on the left in `label`/`--ink-2` (96 px column). Show up to 4 lanes; more collapse into "and 2 more senders", which expands on click.
- **Track:** each lane has a `--sunken` track, 12 px tall, 2 px radius.
- **Ticks:** 1 px wide, 12 px tall, one per email. Color follows status: past sent `--ink-2`, future scheduled `--ink-3`, sending `--signal`, deferred `--deferred-mark`, failed `--failed`.
- **Density:** when there is more than one email per 2 px, ticks become a density bar. Each 2 px column is drawn with height proportional to its count, in the same status colors. This keeps 5,000-email campaigns legible.
- **Hour windows:** a 1 px `--line` divider at every UTC hour boundary that falls inside the range, labeled on the axis in `caption`/`time` style in the user's timezone ("3 PM"). Windows are drawn at the true UTC boundary, which for half-hour timezones falls on ":30".
- **Usage bar:** a 2 px bar under each lane, per window, showing that sender's usage of its hourly cap. It fills in `--ink-3`, switches to `--deferred-mark` at 80%, and a window at its cap gets a `--deferred-soft` background behind the lane.
- **Now line:** a 1 px `--signal` vertical line across all lanes, with a "Now" caption above it. Not shown in the compose preview.
- **Range:** dashboard default is 15 minutes before now to 3 hours after, with a segmented control for 3 h, 12 h, and 24 h. Compose shows the whole planned campaign.
- **Below the strip:** a row of readouts (§7.2).

**Interaction and accessibility**

- The strip is one tab stop. Arrow keys move between lane and window cells; each focused cell shows a tooltip: "Sender B, 3 PM to 4 PM: 200 of 200 used. 37 emails moved to 4 PM."
- Pointer hover shows the same tooltip.
- The strip has `role="img"` and an `aria-label` that summarizes it ("3 senders. 1,240 emails scheduled from 3:40 PM to about 6:42 PM. 37 deferred."). A visually hidden table lists the same per-window numbers.
- Color is never the only signal: the tooltip, readouts, and table carry the same information as text.

**Data:** live data comes from `GET /api/timeline` (tech-spec §5). The compose preview is computed client-side from the shared `estimateFinish()` simulation, so it matches what the worker will do.

### 7.2 Readout

A label over a value, with no box around it. Used in a row under the pace strip and in the compose preview.

- Label: `label` in `--ink-2`. Value: `readout` (narrow width, tabular).
- Values are `--ink`, except Deferred (`--deferred`) and Failed (`--failed`) when they are above zero.
- Row layout: left-aligned, 48 px gap. Below 640 px, a 2×2 grid.
- Dashboard readouts: **Next send** ("3:40:12 PM"), **Finishes around** ("6:42 PM"), **Deferred** ("37"), **Failed** ("2").

### 7.3 Table

- **Container:** a 10 px panel with a hairline border. Sticky header row: 36 px, `--sunken`, `label` in `--ink-2`.
- **Body rows:** 48 px, hairline dividers, `--sunken` on hover.
- **Columns (Scheduled view):** Time (`time` style, left-aligned, 120 px), Recipient (sans, truncated, full value in a tooltip), Subject (`--ink-2`, truncated), Sender (`--ink-2`, 104 px), Status (status mark, 148 px).
- **Columns (Sent view):** Time (finished time), Recipient, Subject, Sender, Status, and a "View in Ethereal" link with an external-link icon. A failed row shows its reason as a `caption` in `--failed` under the subject.
- **Hour groups:** rows are grouped by UTC hour window. Each group starts with a 36 px `--sunken` row: on the left, "3 PM to 4 PM" in `label` weight 600; on the right, each sender's usage for that window in `caption` tabular figures ("Sender A 142/200"), shown in `--deferred` when the sender is at its cap. When a page starts mid-group, the group row repeats with "(continued)".
- **Deferred rows:** time column shows the new time, with "was 3:52 PM" as a caption below it.
- **Relative time** ("in 12 min", "2 h ago") appears in the time tooltip, not inline.
- **Footer:** "1–25 of 1,240" in `caption`, then Previous and Next buttons (secondary, sm).
- Semantic `<table>` with `<th scope="col">`; group rows are `<th scope="rowgroup">`.

### 7.4 Header and navigation

- **Header:** fixed and sized like the landing header: 72 px on the canvas at the top, aligned to the 1200 px content width, with the large lockup. Once the page scrolls it contracts into the same floating bar as the landing header (64 px, 6 px radius, frosted `--surface` at 60% with a strong backdrop blur, `--shadow-float`) in one 500 ms ease-out transition. The separate sub-navigation bar is gone.
- **Left:** lockup, then the nav links Scheduled, Sent, and Settings at `body-lg`. Scheduled and Sent show a count in `label` tabular figures after the label ("Scheduled 1,240").
- **Active link:** a `--sunken` 6 px-radius fill with `--ink` text, the same treatment as the landing scrollspy. Inactive links are `--ink-2`.
- **Right:** search field (256 px, 40 px tall, placeholder "Search emails", a `/` key hint), the 40 px **Compose** primary button, the avatar menu.
- **Below 768 px:** the header row keeps the mark, a search icon button, a Compose icon button, and the avatar. The nav links sit in a second row inside the same bar.
- `/` or ⌘K focuses search; Enter goes to `/dashboard/search?q=`.

### 7.5 Compose panel

Replaces the earlier 640 px modal. Opened by the Compose button or `?compose=1`.

- **Desktop:** an 880 px panel sliding in from the right, full height, `--shadow-float`, 0 px radius on the right edge. The page behind gets an `rgb(15 18 17 / 0.4)` overlay with no blur.
- **Header:** "New campaign" (`title`) and a close button.
- **Body:** two columns.
  - **Left (form, scrolls):** Subject; Message (textarea, 8 rows, character count); Recipients (dropzone); Send from (sender chips); Start (date, time, and a "Send now" switch); Delay between emails; Hourly limit. 20 px between field groups.
  - **Right (preview, sticky, `--canvas` background):** the pace strip with the planned campaign, readouts **First send**, **Finishes around**, **Per sender each hour**, the capacity warning when it applies, and the first 5 recipients.
- **Footer (sticky, top hairline):** Cancel (ghost) and "Schedule 1,240 emails" (primary).
- **Below 768 px:** full-screen sheet. The preview collapses into a summary block above the footer ("Finishes around 6:42 PM"), which expands on tap.
- Escape closes it, asking for confirmation if the form has changes. Focus is trapped while open and returns to the Compose button on close.

### 7.6 Form controls

| Component | Spec |
|---|---|
| **Button** | Variants: `primary` (`--signal` fill, `--signal-fg` text), `secondary` (`--surface`, 1 px `--control` border), `ghost` (transparent, `--sunken` hover), `destructive` (`--failed` fill, white text), `link` (`--signal`, underline on hover). Sizes sm, md, lg. Loading shows a spinner and keeps the width. Icon and label are 8 px apart. Labels say what happens ("Schedule 1,240 emails", "Send test message"). |
| **Google button** | Secondary style at 44 px, official "G" mark, label "Continue with Google", full width in the login panel. |
| **Input / Textarea** | 36 px, 6 px radius, 1 px `--control` border, `--surface` fill. Focus: `--signal` border plus the focus ring. Error: `--failed` border and a `caption` in `--failed` below. Label above with a 6 px gap; helper text in `caption`/`--ink-3`. |
| **Number field** | Input with a suffix unit in `--ink-3` ("seconds", "emails per hour"). Arrow keys step the value. The pacing fields share one helper caption that states the result ("1 email every 36 seconds"). When the plan exceeds what the senders can send, a second caption in `--deferred`: "Your senders can send 600 emails an hour in total. The rest will move to the next hour." |
| **Date and time** | Native date and time inputs (the browser's own picker, which is accessible and familiar on every platform), with the timezone as a caption ("Asia/Kolkata, UTC+05:30"). Disabled while **Send now** is on. |
| **Dropzone** | 120 px, dashed 1 px `--control` border, 10 px radius, upload icon, "Drop a CSV or TXT file, or browse", caption "Up to 2 MB and 5,000 recipients". Drag-over: `--signal` border, `--signal-soft` fill. Once parsed: a file chip (icon, name, size, remove button) and a result line: "1,240 emails ready" in `--ink` weight 600, then "Removed 12 duplicates and 3 invalid addresses" in `--ink-3`. Results are announced with `aria-live="polite"`. |
| **Sender chips** | 32 px toggles, 6 px radius, 1 px `--control` border. Selected: `--signal-soft` fill, `--signal` text, check icon. |
| **Switch** | 20 × 36 px track, `--control` off, `--signal` on. |
| **Segmented control** | Used for the strip range and search status filter. 32 px, `--sunken` track, selected segment `--surface` with a hairline. |

### 7.7 Feedback

| Component | Spec |
|---|---|
| **Skeleton** | `--sunken` blocks, 1.5 s pulse. Tables show 5 rows matching the column widths; the pace strip shows empty tracks. |
| **Empty state** | Inside the table body, left-aligned with 48 px vertical padding: a `section` title and a `body` line in `--ink-2`, then a secondary button. Scheduled: "No emails scheduled" / "Compose a campaign and its sends will appear here and on the strip above." / **Compose** (secondary; the header Compose stays the only primary). Sent: "Nothing sent yet" / "Sent and failed emails appear here once their time comes." The pace strip stays visible with empty tracks and the now line. |
| **Error state** | Inline banner inside the panel: `--failed-soft` background, cross glyph in `--failed`, the API's message, and a secondary **Retry** button. `role="alert"`. |
| **Toast** | Sonner, bottom right, `--surface`, `--shadow-float`, a status glyph, 4 seconds, `role="status"`. Success: "1,240 emails scheduled. First send at 3:40 PM." Errors show the API's message. |
| **Tooltip** | `--ink` background, `--canvas` text, `caption`, 6 px radius, 300 ms delay, also shown on keyboard focus. |
| **Usage meter** | Settings, per sender. A 4 px bar on `--sunken`, fill `--ink-2`, switching to `--deferred-mark` at 80%. Label "142 of 200 this hour"; at the cap, "200 of 200. Resets at 4 PM." in `--deferred`. |

### 7.8 Account and integrations

| Component | Spec |
|---|---|
| **Avatar menu** | 28 px avatar; initials on `--signal-soft` as the fallback. Menu (`--shadow-float`, 10 px radius): name (`label` weight 600) and email (`caption`), divider, Settings, Queue dashboard (external-link icon), divider, Log out. |
| **Slack section** | Disconnected: Slack logo, "Get a Slack message when a sender reaches its hourly limit.", **Connect Slack** (primary; it is the only primary on Settings). Connected: a filled `--ink` dot, "Connected to **#outreach-alerts** in **Acme**", **Send test message** (secondary) and **Disconnect** (ghost with `--failed` text, confirms first). |

## 8. Page layouts

### 8.1 Landing (`/`)

Left-aligned throughout, no centered stack. The page alternates `--canvas` and `--surface` bands so sections read as distinct without decoration.

```
┌ header (sticky): [mark cadence]  How it works  Reliability         [GitHub] [Sign in] ┐
│ hero band (--canvas)                                                                 │
│  Thousands of emails,             ┌ live send queue (--surface, shadow-float) ─────┐ │
│  sent at the pace you set.        │ Q4 outreach                         ● Sending   │ │
│                                   │ 20 of 27 sent   ▓▓▓▓▓▓▓▓░░  next at 2:53 PM     │ │
│  Schedule a campaign, …           │ 2:53 PM  jay@dunder.io   Sender A  ◐ Sending    │ │
│  [Continue with Google] [GitHub]  └─────────────────────────────────────────────────┘ │
│  Free demo. Mail goes to Ethereal…                                                   │
├ How a campaign runs (--surface) ─────────────────────────────────────────────────────┤
│  [upload UI piece]       [pacing fields piece]     [timetable rows piece]            │
│  1 Upload recipients     2 Set the pace            3 Watch it send                   │
├ What happens when… (--canvas) ───────────────────────────────────────────────────────┤
│  one panel of rows: situation | outcome | proof (status mark + note)                 │
├ closing call to action (--surface) ──────────────────────────────────────────────────┤
│  Schedule your first campaign in a minute.         [Continue with Google] [GitHub]   │
└ footer (--canvas): lockup, tech line, links ─────────────────────────────────────────┘
```

- **Header:** fixed and generously sized: 80 px tall at the top with the large lockup (24 px mark, 21 px wordmark), section links at 16 px, a 40 px GitHub icon button, and a 40 px **Sign in** secondary button that keeps its normal 6 px radius in both states. Once the page scrolls, the header contracts into a floating bar (max 920 px, 64 px tall, the same 6 px radius as buttons, frosted: `--surface` at 60% with a strong backdrop blur and a slight saturation boost, `--shadow-float`) in one 500 ms ease-out transition. Section links highlight the section in view with a `--sunken` 6 px-radius fill. On the landing page the logo scrolls smoothly back to the top (and clears the URL hash) instead of reloading.
- **Viewport sections:** the hero, How a campaign runs, and What happens when… each fill at least one screen (`min-height: 100svh`) with their content centered vertically; the closing call to action shares the last screen with the footer. Content can still grow past a screen on small viewports.
- **Scale:** the landing page uses a larger scale than the app: hero headline 60/64 (52 on tablets, 38 on phones), hero body 19/32, section titles 40/46, step titles 21/28, body 17/28, and 48 px hero buttons. Content width is 1280 px.
- **Color, with intent:** the live send queue floats on a soft `--signal` glow: a radial haze centered behind the card (55% teal at the center, fading to nothing), blurred so it has no edge; the guarantees band's figures are `--signal` and its column dividers fade out at both ends; step numbers sit in `--signal-soft` badges; reliability proofs are chips tinted with their status's soft color (deferred, failed) or `--sunken`; and the closing call to action is a full `--signal` band with `--signal-fg` text.
- **Guarantees band:** anchors the bottom of the hero screen: four facts that are enforced or measured (sent once, about 50 ms from planned time to dispatch, 5,000 recipients, zero cron jobs), with a narrow tabular `--signal` figure over a one-line caption.
- **Live send queue:** the one showcased, floating element on the page, so it is the only resting element allowed `--shadow-float`. It shows a campaign the way a person thinks about it, not as a chart: a header (campaign name, sender count and cap, a `--signal-soft` "Sending" or "Finished" chip), a progress line ("20 of 27 sent", the next send time) over a bar where sent is `--signal` and moved-but-waiting is `--deferred-mark`, and a five-row timetable (time, recipient, sender, status mark). The in-flight row is tinted `--signal-soft`; sent rows fade back. When a sender reaches its cap, its moved emails show **Deferred** with "was 2:28 PM" under their new time, and a `--deferred-soft` note slides open below the list: "Sender B reached its limit of 12 emails this hour. 4 emails moved to 3:00 PM UTC. Nothing is dropped." The numbers come from the same `estimateFinish()` simulation the product uses. It replaces the earlier pace-strip board, which read as a chart people had to decode.
- **The one orchestrated moment, on a loop:** the queue sends one email every 0.85 s (the list rolls up one row each time, so the in-flight email stays second from the top), Sender B reaches its cap partway through, the note appears, and the moved emails go out at 3:00 PM. It holds the finished state for about 2.5 seconds and starts again, without animating backwards. It pauses while off screen or while the tab is hidden. Under reduced motion it rests on a representative moment, still.
- **How a campaign runs:** each step pairs a small, static piece of the real interface (file chip and result line, pacing fields with the computed interval, timetable rows with status marks) with a numbered title and one sentence. The steps are a real sequence, so they are numbered; the numerals are `--signal`.
- **What happens when…:** one panel of hairline-separated rows: the situation in `section` style, the outcome in `body-lg`/`--ink-2`, and a proof cell with a status mark and a caption ("Sent, 1 attempt"). These are the PRD's acceptance criteria, written for users.
- **Closing call to action:** a full-width `--signal` band, centered: the brand's four ticks at display size (three in `--signal-fg` at 45%, the last in full `--signal-fg`), a 56 px title, one line of body, and the same two hero buttons (GitHub turns `--signal-fg` on the band).
- **No** product screenshot, glow, dot grid, feature-card grid, eyebrow labels, or separate tech strip section.
- Sections have 96 px of vertical padding (64 px on mobile).

### 8.2 Login (`/login`)

Minimal and calm: one task on the page.

- **Top bar** (80 px, no background): the large lockup on the left, linking home, and a ghost **Back to home** button with a left arrow on the right.
- **Panel:** centered, 440 px wide, 40 px padding (28 px on phones), 10 px radius, hairline border, `--shadow-float`, floating on the same soft teal glow as the landing hero. Inside: "Sign in to Cadence" (30/36, 600), one line of body in `--ink-2` ("Schedule campaigns and watch them send at your pace."), an error banner when the OAuth `error` parameter is present, a full-width 48 px Google button, and a `--sunken` note with a `--signal` shield icon: "This is a demo. Mail goes to Ethereal, a test inbox, and is never delivered to real people."
- **Below the panel:** one centered caption about data use ("We only use your Google name, email, and photo to sign you in."), followed by a **Privacy policy** link.
- **Footer:** "Cadence" on the left and a GitHub link on the right, in `label`/`--ink-3`.
- **Motion:** the panel rises in on load (the landing `rise` animation); the caption follows 150 ms later. Static under reduced motion.

### 8.2.1 Privacy (`/privacy`)

A static, plain-language policy (Google requires its URL to publish the OAuth app). The lockup top-left linking home, then a 720 px reading column: the page title (36/42, 600), a "Last updated" line in `label`/`--ink-3`, and short `section`-titled blocks in `body-lg`/`--ink-2`. Links to it sit in the landing footer and under the sign-in panel.

### 8.3 Dashboard

```
┌ [mark] cadence   Scheduled 1,240   Sent 312   Settings     [Search emails  /] [Compose] (A) ┐
├──────────────────────────────────────────────────────────────────────────────────────────┤
│ Scheduled                                                         [3 h | 12 h | 24 h]     │  title + strip range
│ ┌ pace strip ─────────────────────────────────────────────────────────────────────────┐ │
│ │ Sender A  ▏▏▏▏▏▏▏▏▏▏│▏▏▏▏▏▏▏▏     now ┃                                              │ │
│ │ Sender B  ▏▏▏▏▏▏▏▏▏▏│▏▏▏▏▏▏▏▏▏▏▏ (amber)                                            │ │
│ │ Sender C  ▏▏▏▏▏▏▏▏▏▏│▏▏▏▏▏▏                                                          │ │
│ │           3 PM          4 PM          5 PM          6 PM                               │ │
│ └─────────────────────────────────────────────────────────────────────────────────────┘ │
│  Next send      Finishes around      Deferred      Failed                                │  readouts
│  3:40:12 PM     6:42 PM              37            2                                     │
│                                                                                          │
│ ┌ table ──────────────────────────────────────────────────────────────────────────────┐ │
│ │ Time          Recipient          Subject             Sender     Status               │ │
│ │ 3 PM to 4 PM                            Sender A 142/200  Sender B 200/200  C 98/200  │ │
│ │ 3:40:12 PM    a@acme.com         Quick question      Sender A   ○ Scheduled          │ │
│ │ 4 PM to 5 PM                                                                         │ │
│ │ 4:00:02 PM    d@globex.com       Quick question      Sender B   ↷ Deferred           │ │
│ │ was 3:52 PM                                                                          │ │
│ └ 1–25 of 1,240                                                   [Previous] [Next]  ┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Compose** in the header is the only primary button on the page.
- **Page head:** every dashboard page opens with a 36/42 title (28/34 on phones) and one line of context in `body-lg`/`--ink-2`, with the page's controls (the strip range) aligned to its bottom right.
- **Color, with intent:** the pace strip is the page's one floating element: it gets `--shadow-float` and sits on the landing hero's soft `--signal` glow, toned down (26% at the center) so it never competes with status color.
- **Readouts band:** the readouts sit in one `--surface` panel as equal columns divided by hairlines that fade out at both ends (the landing guarantees band), with values at 30/36. In Compose they stay a plain row.
- **Empty states:** centered: the four ticks (three `--line`, the last `--signal`), a 19/28 title, one line of body, and a secondary action.
- **Motion:** the page head, strip, readouts, and table rise in on load, 80 ms apart (the landing `rise`). Static under reduced motion.
- The Sent page uses the same layout without the strip range control; its strip shows the last 3 hours, and the readouts are **Sent today**, **Sent in the last hour**, **Failed**.
- Search (`/dashboard/search`) uses the same table without hour groups, sorted by relevance, with matches highlighted in `--signal-soft` and a status segmented control (All, Scheduled, Deferred, Sent, Failed).

### 8.4 Settings

A single column, max width 720 px. Sections are separated by `section` headings and hairlines, not boxed cards:

1. **Slack** (§7.8).
2. **Senders:** one row per sender: label, from-address (sans), and a usage meter.
3. **Sending limits:** a read-only definition list (minimum gap, hourly cap per sender, worker concurrency) from `GET /api/config`, with a caption: "These are set on the server."
4. **Queue dashboard:** a link with an external-link icon to Bull Board.

## 9. Motion

| Interaction | Animation |
|---|---|
| Compose panel | Slides in from the right, 200 ms ease-out (exit 150 ms); overlay fades |
| Menus and popovers | Fade plus translateY 4 px → 0, 150 ms |
| Header underline | Slides between links, 200 ms ease-out |
| Pace strip ticks | Color changes over 150 ms as status changes; the now-line advances smoothly between polls |
| Sending mark | 2 s opacity pulse, 1 → 0.5 |
| New table rows (polling) | `--signal-soft` background fading to transparent over 1.2 s |
| Status change | Glyph and label crossfade, 150 ms |
| **Landing:** hero entrance | The page's one load-time sequence: headline, body, buttons, note, and board rise 14 px and fade in, staggered 0–360 ms, 700 ms each on `cubic-bezier(0.22, 1, 0.36, 1)` |
| **Landing:** live queue | One send every 0.85 s: rows roll up 500 ms on the landing curve, status marks crossfade, the progress bar grows, and the limit note slides open; a 2.5 s hold, then it restarts; paused off screen or in a hidden tab |
| **Landing:** header | Bar to pill on scroll, 500 ms on the same curve |
| **Landing:** sections | Each heading, step, and reliability row fades and lifts 16 px once, the first time it enters the viewport; siblings stagger by 90–120 ms |
| **Landing:** step visuals | Start when visible: the recipient count counts up to 1,240 and sender chips appear in turn; the miniature strip draws its ticks left to right; timetable rows step through Scheduled, Sending, Sent on a loop |
| **Landing:** closing mark | The four ticks draw upward in turn, 140 ms apart |
| Reduced motion | Everything above is instant or static; content never starts hidden (reveal states apply only with motion allowed); loops stop on their final frame; anchor scrolling jumps |

Motion on the landing page always shows the product doing its job (sending, pacing, deferring); nothing moves just to decorate. No parallax, no scroll-jacking, no bounce.

## 10. Accessibility

- Every token pair in §3 was checked: all text passes AA; `--ink` passes AAA; control boundaries (`--control`) and the deferred tick color pass 3:1.
- Visible 2 px focus ring on every interactive element, including pace strip cells.
- Keyboard: logical tab order, Enter and Space on controls, Escape closes overlays, arrow keys in the nav, segmented controls, and pace strip.
- Tables use semantic markup (`<th scope="col">`, `<th scope="rowgroup">` for hour groups). Status marks always include their text label.
- The pace strip has a text summary and a visually hidden table equivalent (§7.1).
- The dropzone is a real `<input type="file">` with a label; parse results use `aria-live="polite"`.
- Toasts use `role="status"`; errors use `role="alert"`.
- Minimum touch target on mobile is 44 × 44 px.

## 11. Voice and copy

- **Tone:** direct, calm, specific. "You", sentence case, no exclamation marks.
- **Name things by what users see,** not how the system works: "recipients", not "leads"; "message", not "body"; "Slack message", not "webhook".
- **Numbers** use `Intl.NumberFormat` ("1,240"). **Times** use `Intl.DateTimeFormat` in the user's timezone, with the zone shown in Compose and in time tooltips. Slack messages use UTC, since Slack doesn't know the user's timezone.
- **No "·" chains.** Put separate facts in separate readouts, columns, or sentences.
- **No arrow characters in text.** Use an icon only where it means something (external link, back).
- **Failures say what happened and are visible in place.** A failed row shows its reason in the row.
- **Examples:**
  - Defer tooltip: "Sender B reached 200 emails this hour. Moved to 4:00 PM."
  - Empty: "No emails scheduled. Compose a campaign and its sends will appear here and on the strip above."
  - Error: "Couldn't schedule: the start time is more than 5 minutes in the past."
  - Capacity warning: "Your senders can send 600 emails an hour in total. The rest will move to the next hour."
  - Success toast: "1,240 emails scheduled. First send at 3:40 PM."
  - Slack: "⚠️ Sender A reached its hourly limit (200 of 200). About 37 emails moved to 4:00 PM UTC."

## 12. Tailwind v4 token sketch

```css
@import "tailwindcss";

@theme {
  --font-sans: var(--font-instrument-sans), ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;

  --color-canvas: var(--canvas);
  --color-surface: var(--surface);
  --color-sunken: var(--sunken);
  --color-line: var(--line);
  --color-control: var(--control);
  --color-ink: var(--ink);
  --color-ink-2: var(--ink-2);
  --color-ink-3: var(--ink-3);
  --color-signal: var(--signal);
  --color-signal-hover: var(--signal-hover);
  --color-signal-fg: var(--signal-fg);
  --color-signal-soft: var(--signal-soft);
  --color-deferred: var(--deferred);
  --color-deferred-mark: var(--deferred-mark);
  --color-deferred-soft: var(--deferred-soft);
  --color-failed: var(--failed);
  --color-failed-soft: var(--failed-soft);

  --radius-control: 6px;
  --radius-panel: 10px;
  --shadow-float: 0 8px 24px -6px rgb(15 18 17 / 0.16), 0 0 0 1px var(--line);
}

:root {
  --canvas:#F3F4F2; --surface:#FFFFFF; --sunken:#EBEDEA;
  --line:#DCE0DC; --control:#858E89;
  --ink:#141817; --ink-2:#48514E; --ink-3:#66706C;
  --signal:#0B6E69; --signal-hover:#085854; --signal-fg:#FFFFFF; --signal-soft:#E3F1EF;
  --deferred:#8A5300; --deferred-mark:#C77A00; --deferred-soft:#FBF1E1;
  --failed:#B42318; --failed-soft:#FCEBE9;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --canvas:#0F1211; --surface:#151918; --sunken:#1B201E;
    --line:#262C2A; --control:#66706B;
    --ink:#ECEFED; --ink-2:#A9B2AE; --ink-3:#87918D;
    --signal:#4CC2B8; --signal-hover:#6FD3CA; --signal-fg:#06201E; --signal-soft:#12302D;
    --deferred:#E8A33D; --deferred-mark:#E8A33D; --deferred-soft:#2A1F0C;
    --failed:#F07167; --failed-soft:#2E1412;
  }
}
:root[data-theme="dark"] { /* same dark values as above */ }

body { background: var(--canvas); color: var(--ink); }
.time, .readout, .num { font-variant-numeric: tabular-nums; }
.time, .readout { font-stretch: 85%; }
```
