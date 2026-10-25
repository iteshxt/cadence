# Cadence — Design Language

> **Quiet, precise, trustworthy.** Cadence is infrastructure with a face. The UI should feel like a well-made instrument: calm neutrals, one confident accent, crisp type, and status colors that carry meaning.

| | |
|---|---|
| **Companion docs** | [`prd.md`](./prd.md) · [`tech-spec.md`](./tech-spec.md) |

---

## 1. Principles

1. **Content first, chrome last.** Tables and data are the product. Borders are hairlines, shadows are rare, and nothing decorates for the sake of decoration.
2. **One accent, used with intent.** Cobalt appears only on primary actions, active states, focus rings, and links. If everything is blue, nothing is.
3. **Color means status.** Amber, blue, violet, green, and red are reserved for email states and are never used decoratively.
4. **Contrast is not optional.** Every text and background pair meets WCAG AA (4.5:1 for body text, 3:1 for large text and UI). Primary text targets AAA.
5. **Calm motion.** Transitions are 150–200 ms ease-out and explain changes without performing.
6. **Precise copy.** Numbers are formatted, times are explicit (with the timezone), and the UI never says "Something went wrong" without a reason.

## 2. Brand

- **Name:** Cadence. Always capitalized in prose. The wordmark is lowercase: `cadence`.
- **Mark:** three dots of increasing size, rising left to right, standing for paced sends, rhythm, and growth. It sits on a 20×20 grid with dots of 4, 5, and 6 px. It is drawn in `--accent`, or in `--fg` for the monochrome variant.
- **Wordmark:** Geist Sans, weight 600, letter-spacing −0.02em.
- **Lockup:** the mark, an 8 px gap, then the wordmark. Minimum height is 20 px.
- **Favicon:** the mark on a rounded `--accent` square with white dots.

## 3. Color

All colors are defined as CSS variables on `:root` and remapped under `[data-theme="dark"]` and `prefers-color-scheme: dark`. Tailwind v4 exposes them through `@theme`.

### 3.1 Neutrals and accent

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FAFAFA` | `#09090B` | App canvas |
| `--surface` | `#FFFFFF` | `#111113` | Cards, tables, dialogs |
| `--surface-muted` | `#F4F4F5` | `#18181B` | Table header, hover rows, inputs (dark) |
| `--border` | `#E4E4E7` | `#27272A` | Hairlines (1px) |
| `--border-strong` | `#D4D4D8` | `#3F3F46` | Inputs, dividers that need presence |
| `--fg` | `#0A0A0B` | `#FAFAFA` | Primary text (AAA on bg and surface) |
| `--fg-muted` | `#52525B` | `#A1A1AA` | Secondary text, labels (AA+) |
| `--fg-subtle` | `#71717A` | `#8B8B94` | Placeholders, meta, timestamps (AA) |
| `--accent` | `#2347F0` | `#7A8CFF` | Primary buttons, links, active tab, focus |
| `--accent-hover` | `#1A37C9` | `#97A5FF` | Hover state |
| `--accent-fg` | `#FFFFFF` | `#0A0A0B` | Text on accent |
| `--accent-soft` | `#EEF1FE` | `#1A1F3D` | Selected rows, active nav background |
| `--ring` | `#2347F0` @ 40% | `#7A8CFF` @ 50% | Focus ring (2px plus a 2px offset) |

**Contrast rules:**
- Never place `--fg-subtle` text on `--surface-muted` at sizes below 14 px.
- Accent text on white is for links and labels only. Body copy stays `--fg`.

### 3.2 Status colors

Each badge pairs a soft fill with a strong text color, and every pair passes AA.

| Status | Meaning | Light (bg / text / dot) | Dark (bg / text / dot) |
|---|---|---|---|
| `scheduled` | Waiting for its time | `#FEF3C7` / `#92400E` / `#F59E0B` | `#2A1F05` / `#FCD34D` / `#F59E0B` |
| `sending` | Claimed by a worker | `#DBEAFE` / `#1E40AF` / `#3B82F6` | `#0B1A33` / `#93C5FD` / `#3B82F6` |
| `deferred` | Moved by the rate limit | `#EDE9FE` / `#5B21B6` / `#8B5CF6` | `#1E1436` / `#C4B5FD` / `#8B5CF6` |
| `sent` | Delivered to SMTP | `#DCFCE7` / `#166534` / `#22C55E` | `#0A2615` / `#86EFAC` / `#22C55E` |
| `failed` | Gave up after retries | `#FEE2E2` / `#991B1B` / `#EF4444` | `#2D0E0E` / `#FCA5A5` / `#EF4444` |
| `cancelled` | Stopped by the user | `#F4F4F5` / `#3F3F46` / `#A1A1AA` | `#18181B` / `#D4D4D8` / `#71717A` |

**Semantic tokens:**
- `--success`: `#16A34A`
- `--danger`: `#DC2626`, used for destructive buttons and errors
- `--warning`: `#D97706`

## 4. Typography

| | |
|---|---|
| **Sans** | **Geist Sans** (via `next/font`), falling back to `ui-sans-serif, system-ui` |
| **Mono** | **Geist Mono**, for email addresses in tables, IDs, timestamps, and code |
| **Features** | `font-feature-settings: "tnum"` on all numeric columns and stat values (tabular figures) |

| Token | Size / line height | Weight | Tracking | Use |
|---|---|---|---|---|
| `display` | 56 / 60 | 600 | −0.03em | Landing hero (40/44 on mobile) |
| `h1` | 30 / 36 | 600 | −0.02em | Page titles |
| `h2` | 20 / 28 | 600 | −0.01em | Section and card titles |
| `h3` | 16 / 24 | 600 | 0 | Subsections, dialog sections |
| `body` | 14 / 20 | 400 | 0 | Default UI text |
| `body-lg` | 16 / 24 | 400 | 0 | Landing copy, dialog descriptions |
| `label` | 13 / 18 | 500 | 0 | Form labels, table headers (sentence case, not uppercase) |
| `caption` | 12 / 16 | 400 | 0 | Meta, helper text, timestamps |
| `stat` | 28 / 32 | 600 | −0.02em | Stat card numbers (tabular) |

## 5. Space, size, and shape

- **Spacing:** a 4 px base. The scale is 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, and 96.
- **Radius:** 6 px (badges, small controls), 8 px (buttons, inputs), 12 px (cards, tables, dialogs), and fully round (avatars, status dots).
- **Borders:** 1 px `--border` everywhere. No double borders, so a table inside a card loses its own outer border.
- **Elevation:** almost flat.
  - `shadow-sm`: `0 1px 2px rgb(0 0 0 / 0.04)`, for cards on the landing page only
  - `shadow-lg`: `0 12px 32px -8px rgb(0 0 0 / 0.18)`, for dialogs, popovers, and menus
- **Control heights:** 32 px (sm), 36 px (default), and 44 px (lg, for landing calls to action and the Google button).
- **Layout:**
  - Content max width is 1200 px. Gutters are 24 px on desktop and 16 px on mobile.
  - The header is 56 px tall.
  - Breakpoints: `sm 640`, `md 768`, `lg 1024`, `xl 1280`.

## 6. Iconography and imagery

- **lucide-react**, with a 1.5 px stroke at 16 px (inline) or 20 px (buttons and empty states).
- Icons inherit `currentColor`. They are never multicolored.
- **No stock illustrations.** Empty states use a single 20 px icon in a 40 px `--surface-muted` circle.
- Landing visuals are real product screenshots in a 12 px-radius frame with a hairline border, plus a soft gradient glow behind them: `--accent` at 8% opacity, blurred 120 px. This glow is the only decorative gradient in the system.

## 7. Components

All components are built on shadcn/ui and Radix and live in `components/ui`. Every interactive element has `hover`, `active`, `focus-visible` (ring), and `disabled` (50% opacity, `not-allowed` cursor) states.

| Component | Spec |
|---|---|
| **Button** | Variants: `primary` (accent fill), `secondary` (surface, `--border-strong` border), `ghost` (transparent, `--surface-muted` hover), `destructive` (danger fill), and `link`. Sizes are sm, md, and lg. A loading state shows a spinner and keeps the button's width. Icon and label are separated by an 8 px gap. |
| **Google button** | Secondary style at 44 px, with the official multicolor "G" mark (the only multicolor icon allowed) and the label "Continue with Google". It is full width in the login card. |
| **Input / Textarea** | 36 px tall, 8 px radius, `--border-strong` border, `--surface` background. On focus, the border turns accent and the ring appears. The error state uses a danger border and a caption below in `--danger`. The label sits above with a 6 px gap. Helper text is a caption in `--fg-subtle`. |
| **Number field** | An input with a suffix unit ("seconds", "/ hour") in `--fg-subtle`. Arrow keys step the value. |
| **Date/time picker** | A popover calendar plus a time input. It shows the timezone as a caption (for example, "Asia/Kolkata · UTC+05:30"). |
| **Dropzone** | A 120 px-tall dashed `--border-strong` box (12 px radius) with an upload icon, "Drop CSV or TXT, or **browse**", and the caption "Max 2 MB · 5,000 leads". On drag-over, it gets an accent border and an `--accent-soft` fill. Once parsed, it becomes a file chip (file icon, name, size, and × to remove) above a result line: **"1,240 emails detected"** in `--fg` semibold, followed by "· 12 duplicates · 3 invalid removed" in `--fg-subtle`. |
| **Sender chips** | Toggleable pills (32 px). Selected pills have an `--accent-soft` background, accent text, and a check icon. |
| **Badge (status)** | 22 px tall, 6 px radius, horizontal padding of 8 px, `label` type. A 6 px dot, a 6 px gap, then sentence-case text ("Scheduled"). Colors come from §3.2. |
| **Tabs** | Underline tabs in the dashboard sub-nav. Labels are `--fg-muted`. The active tab is `--fg` with a 2 px accent underline that animates position over 200 ms. Each tab shows a count pill (for example, `Scheduled 1,240`). |
| **Table** | A card container. The header row is 40 px tall with a `--surface-muted` background and `label`-style text in `--fg-muted`. Body rows are 52 px tall with a hairline divider and `--surface-muted` on hover. Columns: recipient (mono, truncated, with the full value in a tooltip), subject (truncated with a tooltip), time (absolute "Oct 25, 3:40 PM", with relative time as a caption: "in 12 min" or "2h ago"), and status (a badge). Numeric and time columns are right-aligned with tabular figures. A sticky header. Pagination sits in the footer: "Showing 1–25 of 1,240", followed by Prev and Next buttons. |
| **Skeleton** | `--surface-muted` blocks with a 1.5 s pulse. Table skeletons have 5 rows and match the column widths. |
| **Empty state** | Centered in the table body with 48 px vertical padding: an icon circle, a title in `h3` ("No scheduled emails"), body text in `--fg-muted` ("Compose a campaign and it'll show up here."), and a primary **Compose** button. The Sent tab says "Nothing sent yet" and has no button. |
| **Error state** | An inline banner inside the card: a danger-tinted icon, the message, and a secondary **Retry** button. |
| **Stat card** | A surface card with 20 px padding. A `label` in `--fg-muted` with a status dot, a `stat` number, and a caption for context ("+86 in the last hour"). They sit in a 4-column grid (2 columns on tablet, horizontal scroll on mobile). |
| **Dialog (Compose)** | 640 px wide, 12 px radius, `shadow-lg`, over an overlay of `rgb(9 9 11 / 0.5)` with a 2 px blur. The header has an `h2` title and a close button. The body scrolls with 24 px padding and 20 px between field groups. The footer is sticky with a top hairline: the estimate on the left, Cancel and Schedule on the right. On mobile it becomes a full-height bottom sheet. Escape closes the dialog, asking for confirmation if the form has changes. |
| **Toast** | Sonner, bottom right, using the surface style and a status icon. Success says "1,240 emails scheduled · first at 3:40 PM". Errors show the API's message. Toasts last 4 seconds. |
| **Avatar menu** | A 32 px avatar, with initials as a fallback on `--accent-soft`. The dropdown contains: name (`h3`) and email (caption), a divider, Settings, Queue dashboard ↗, a divider, Log out. |
| **Slack card** | When disconnected: the Slack logo, "Get notified when a sender hits its hourly limit.", and a primary **Connect Slack** button. When connected: a green dot, "Connected to **#outreach-alerts** in **Acme**", and the buttons **Send test** and **Disconnect** (ghost, with danger text). |
| **Usage meter** | A 6 px bar on `--surface-muted` with an accent fill. The fill turns amber at 80% and violet when it reaches the cap. A label reads "142 / 200 this hour". |
| **Tooltip** | `--fg` background, `--bg` text, `caption` size, 6 px radius, 300 ms delay. |

## 8. Page layouts

### 8.1 Landing (`/`)

```
┌ nav: [mark cadence]                         [Sign in] ┐
│                                                       │
│   Email scheduling that keeps its promises.            │  display, centered, max 720
│   Schedule thousands of emails, send at a safe pace,   │  body-lg, fg-muted
│   and never send one twice.                            │
│   [ Get started with Google ]   [ View on GitHub ]     │  lg buttons
│                                                       │
│   ┌──────── product screenshot (dashboard) ────────┐  │  glow behind
│   └────────────────────────────────────────────────┘  │
│                                                       │
│   How it works   ① Upload leads  ② Set the pace  ③ Send │  3 columns, numbered
│                                                       │
│   Built like infrastructure  (3×2 feature grid)        │  icon + h3 + caption
│   Delayed jobs · Restart-safe · Rate limits ·          │
│   Exactly-once · Slack alerts · Full-text search       │
│                                                       │
│   Tech strip: Next.js · Express · BullMQ · Redis ·     │  fg-subtle, mono
│   Postgres · Elasticsearch                             │
└ footer: © Cadence · Docs · GitHub ────────────────────┘
```

Sections have 96 px of vertical padding (64 px on mobile). The page uses the white `--surface` background with a faint 24 px dot grid behind the hero, drawn in `--border` at 50% opacity.

### 8.2 Login (`/login`)

The `--bg` canvas holds a centered 400 px card with 32 px padding. Inside: the mark, "Sign in to Cadence" (`h2`), "Use your Google account to continue." (`--fg-muted`), the Google button, and a caption ("By continuing you agree to…"). Errors appear in a danger banner above the button. A ← Back link sits in the top left.

### 8.3 Dashboard shell

```
┌ header 56px: [mark cadence]   [ 🔍 Search emails…  ⌘K ]        [avatar ▾] ┐
├ subnav: Scheduled 1,240 │ Sent 312 │ Settings                [+ Compose] ┤
│                                                                          │
│  [Scheduled 1,240] [Deferred 37] [Sent today 312] [Failed 2]   stat cards │
│                                                                          │
│  ┌ table card ─────────────────────────────────────────────────────────┐ │
│  │ Recipient            Subject              Scheduled for      Status  │ │
│  │ a@acme.com           Quick question…      Oct 25, 3:40 PM  ● Sched. │ │
│  │                                           in 12 min                  │ │
│  └ Showing 1–25 of 1,240                               [‹ Prev] [Next ›]┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

- The header has a `--surface` background and a bottom hairline. It is sticky.
- **Compose** is the only primary (accent) button on the page.
- `⌘K` or `/` focuses search. Enter goes to `/dashboard/search?q=`.

### 8.4 Settings

A single column with a maximum width of 720 px and stacked cards: **Integrations** (Slack), **Senders** (rows: label, from email in mono, and a usage meter), and **Sending limits** (read-only key/value rows with a caption explaining that these are server-configured), followed by a link card to the Queue dashboard ↗.

## 9. Motion

| Interaction | Animation |
|---|---|
| Dialog | Fade plus scale 0.98 → 1, 180 ms ease-out (exit 120 ms) |
| Popover and menu | Fade plus translateY 4 px → 0, 150 ms |
| Tab underline | Slides 200 ms ease-out |
| New table rows (polling) | `--accent-soft` background that fades to transparent over 1.2 s |
| Status change | The badge crossfades over 150 ms |
| Reduced motion | All of the above become instant when `prefers-reduced-motion` is set |

## 10. Accessibility

- AA contrast or better is checked for every token pair (§3). There is a visible 2 px focus ring on every interactive element.
- Full keyboard support: Tab order, Enter and Space on controls, Escape closes overlays, arrow keys in tabs.
- Tables use semantic `<table>` markup with `<th scope="col">`. Status badges include text, never color alone.
- The dropzone is a real `<input type="file">` with a label. Parse results are announced through `aria-live="polite"`.
- Toasts use `role="status"`, and errors use `role="alert"`.
- The minimum touch target is 40 × 40 px on mobile.

## 11. Voice and copy

- **Tone:** direct, calm, and specific. Use "you", sentence case, and no exclamation marks except in the success toast.
- **Numbers:** use `Intl.NumberFormat` ("1,240"). **Times:** use `Intl.DateTimeFormat` in the user's timezone, adding the zone on hover and in Compose.
- **Examples:**
  - Defer tooltip: "Sender B reached 200/hour. Moved to 4:00 PM."
  - Empty: "No scheduled emails. Compose a campaign and it'll show up here."
  - Error: "Couldn't schedule: start time is in the past."
  - Slack: "⚠️ Sender A hit its hourly limit (200/200). 37 emails moved to 4:00 PM UTC."

## 12. Tailwind v4 token sketch

```css
@import "tailwindcss";

@theme {
  --font-sans: var(--font-geist-sans), ui-sans-serif, system-ui;
  --font-mono: var(--font-geist-mono), ui-monospace;
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-muted: var(--surface-muted);
  --color-border: var(--border);
  --color-border-strong: var(--border-strong);
  --color-fg: var(--fg);
  --color-fg-muted: var(--fg-muted);
  --color-fg-subtle: var(--fg-subtle);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-fg: var(--accent-fg);
  --color-accent-soft: var(--accent-soft);
  --radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px;
}

:root {
  --bg:#FAFAFA; --surface:#FFFFFF; --surface-muted:#F4F4F5;
  --border:#E4E4E7; --border-strong:#D4D4D8;
  --fg:#0A0A0B; --fg-muted:#52525B; --fg-subtle:#71717A;
  --accent:#2347F0; --accent-hover:#1A37C9; --accent-fg:#FFFFFF; --accent-soft:#EEF1FE;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg:#09090B; --surface:#111113; --surface-muted:#18181B;
    --border:#27272A; --border-strong:#3F3F46;
    --fg:#FAFAFA; --fg-muted:#A1A1AA; --fg-subtle:#8B8B94;
    --accent:#7A8CFF; --accent-hover:#97A5FF; --accent-fg:#0A0A0B; --accent-soft:#1A1F3D;
  }
}
:root[data-theme="dark"] { /* same dark values as above */ }
body { background: var(--bg); color: var(--fg); }
```
