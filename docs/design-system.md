# Design System & UI Guide

Servio ships a small, deliberately opinionated design system layered on top of
**Tailwind v4**, **base-ui** (via the `base-nova` shadcn style), and
**next-themes**. Servio uses **Relay** and Sable uses **Nova Flow**: Navy surfaces,
Cobalt actions, Mist backgrounds, Ice accents and Manrope display type. Status colour is coded through a
single source of truth in [`lib/constants.ts`](../lib/constants.ts).

This guide documents what actually exists in the repo. For where these pieces sit
in the broader app, see [architecture.md](./architecture.md); for how each
feature module consumes them, see [modules.md](./modules.md).

- [Theme foundation](#theme-foundation)
- [Typography](#typography)
- [base-ui / shadcn setup](#base-ui--shadcn-setup)
- [Primitive library (`components/ui/`)](#primitive-library-componentsui)
- [Shared composite components](#shared-composite-components)
- [Status & priority conventions](#status--priority-conventions)
- [The two shells](#the-two-shells)

---

## Theme foundation

Interface tokens and utilities live in [`app/globals.css`](../app/globals.css).
The generated [`app/brand-tokens.css`](../app/brand-tokens.css) supplies canonical
colours from [`branding/source/brand.json`](../branding/source/brand.json).
There is **no `tailwind.config` file** — Tailwind v4 is configured entirely in CSS
via `@import "tailwindcss"` and the `@theme inline { … }` block. The imports at the
top wire in the animation utilities, the shadcn base layer, and the typography
plugin:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "tw-shimmer";
@plugin "@tailwindcss/typography";

@custom-variant dark (&:is(.dark *));
```

Dark mode is class-based: the `dark` variant matches any element inside a `.dark`
ancestor, and next-themes toggles that class on `<html>` (see
[Typography](#typography) and [The two shells](#the-two-shells)).

### Colour tokens

Colours are CSS custom properties (brand hex values, interface tints and functional OKLCH colours), declared on `:root`
(light) and `.dark`, then re-exported to Tailwind utilities through the
`@theme inline` map (`--color-primary: var(--primary)`, etc.). This is why you
write `bg-primary`, `text-muted-foreground`, `border-sidebar-border` and so on —
each maps back to a variable.

The **actual** token values in `app/globals.css` (do not trust older blueprint
values):

| Token | Light `:root` | Dark `.dark` | Usage |
| --- | --- | --- | --- |
| `--background` | Mist `#F1F4F8` | Navy `#12243A` | Page background |
| `--foreground` | Navy | Mist | Body text |
| `--card` / `--card-foreground` | white / Navy | `#182D46` / Mist | Cards |
| `--popover` / `--popover-foreground` | white / Navy | `#1C324D` / Mist | Menus |
| `--primary` | Cobalt `#3559E8` | `#8FAAFF` | Actions and readable links |
| `--primary-foreground` | white | Navy | Text on primary |
| `--secondary` / `--secondary-foreground` | `#E7ECF5` / Navy | `#203953` / Mist | Secondary buttons |
| `--muted` / `--muted-foreground` | `#E9EEF5` / `#52647C` | `#203953` / `#ACBCD0` | Subtle surfaces/text |
| `--accent` / `--accent-foreground` | `#E5EBFF` / `#2845BF` | `#243D61` / `#DFE8FF` | Hover/active |
| `--destructive` | `oklch(0.585 0.222 24)` | `oklch(0.7 0.19 22)` | Danger red |
| `--border` / `--input` | `#D7E0EC` / `#CBD6E5` | white 9% / 12% | Hairlines and inputs |
| `--ring` | Cobalt | `#8FAAFF` | Focus |
| `--chart-1...5` | Cobalt, teal, steel blue, green, amber | Brighter variants including Ice | Charts |
| `--sidebar` | `#EAF0F7` | `#0F2035` | Sidebar surface |
| `--sidebar-primary`, `--sidebar-accent`, `--sidebar-ring` | Shared primary/accent/ring | Shared primary/accent/ring | Navigation |
| `--sable` / `--sable-foreground` / `--sable-muted` | Navy / white / `#E6EDF4` | white / Navy / `#213951` | AI controls |

The **`--sable*`** trio keeps dense AI surfaces monochrome: Navy on light,
white on dark. It maps to `bg-sable`, `text-sable`, `text-sable-foreground` and
`bg-sable-muted`. Consumers include `AiButton`, inline ticket suggestions,
summary/draft cards and the composer send controls. The launcher uses a Navy
tile with the Cobalt/Ice Nova Flow symbol. `sable-accent-border` and `sable-glow`
use the same two colours for restrained borders and shadows.

The dark theme is the **default** (`defaultTheme="dark"` in the root layout), so
verify contrast in dark first.

### Radius scale

A single `--radius: 0.7rem` drives a derived scale in `@theme inline`:

| Utility | Formula |
|---------|---------|
| `rounded-sm` | `--radius * 0.6` |
| `rounded-md` | `--radius * 0.8` |
| `rounded-lg` | `--radius` |
| `rounded-xl` | `--radius * 1.4` |
| `rounded-2xl` | `--radius * 1.8` |
| `rounded-3xl` / `4xl` | `* 2.2` / `* 2.6` |

### Base layer & utilities

The `@layer base` block applies sensible global defaults: every element gets
`border-border` and a semi-transparent `outline-ring/50`; the body sets
`bg-background text-foreground`, enables the `cv11`/`ss01` font features, and
antialiases; `h1/h2/h3` (and any `.font-display`) use the display font with
`-0.02em` letter-spacing.

A few custom utilities are worth knowing:

| Utility | Purpose |
|---------|---------|
| `.bg-grid` | Subtle 40px grid texture (used on auth/hero backdrops), drawn with `color-mix` over `--border`. |
| `.bg-grid-fade` | Grid texture masked by a radial fade, for refined hero backdrops (pair with `.bg-grid`). |
| `.bg-aurora` | Cobalt/Ice ambient wash anchored top-centre; once per surface as a hero backdrop. |
| `.glow` | Soft primary-tinted ring + drop shadow for emphasised surfaces. |

Scrollbars are globally set to `thin` with a `--border` thumb.

---

## Typography

Fonts are wired in [`app/layout.tsx`](../app/layout.tsx) with `next/font/local`
(bundled Manrope) and `next/font/google` (Inter, JetBrains Mono)
and exposed as the CSS variables referenced by the `@theme` map:

| Role | Font | CSS variable | Token |
|------|------|--------------|-------|
| Body / UI (`font-sans`) | **Inter** | `--font-sans` | default `html` font |
| Display / headings (`font-display`, `font-heading`) | **Manrope**, local variable font, weights 200–800 | `--font-display` | `h1–h3`, `.font-display` |
| Monospace (`font-mono`) | **JetBrains Mono** | `--font-mono` | ref numbers, kbd, code |

All three are attached to `<body>` as `${inter.variable} ${manrope.variable}
${jetbrains.variable} font-sans antialiased`. Use `font-display` for headings,
stat values, and anything that should read as a "title"; `tabular-nums` is
applied to numeric displays (e.g. [`stat-card.tsx`](../components/stat-card.tsx),
[`pagination-bar.tsx`](../components/pagination-bar.tsx)).

Servio and Sable wordmarks are **outlined Manrope 750 artwork**, rendered by
`BrandName`. `Logo` renders Relay; `SableMark` renders the six-segment Nova Flow.
Geometry comes from the generated [`lib/brand-assets.ts`](../lib/brand-assets.ts).

The `<ThemeProvider>` (a thin wrapper over next-themes,
[`components/theme-provider.tsx`](../components/theme-provider.tsx)) is configured
in the root layout with `attribute="class"`, `defaultTheme="dark"`,
`enableSystem`, and `disableTransitionOnChange`. `<html>` carries
`suppressHydrationWarning` to avoid theme-flash warnings.

---

## base-ui / shadcn setup

Servio uses shadcn's newer **`base-nova`** style, which generates components on top
of [**base-ui**](https://base-ui.com) (`@base-ui/react` **^1.9.0**) rather than
Radix. Configuration lives in [`components.json`](../components.json):

```jsonc
{
  "style": "base-nova",
  "rsc": true,
  "tsx": true,
  "tailwind": { "css": "app/globals.css", "baseColor": "neutral", "cssVariables": true },
  "iconLibrary": "lucide",
  "aliases": { "ui": "@/components/ui", "components": "@/components", "utils": "@/lib/utils", "lib": "@/lib", "hooks": "@/hooks" }
}
```

Add primitives with the shadcn CLI, which will scaffold into `components/ui/`
against this config. Icons come from **lucide-react** everywhere.

> [!IMPORTANT]
> base-ui is **not** Radix. Two conventions differ from most shadcn code you have
> seen (and from stale training data). Follow them exactly:

### Gotcha 1 — `render` instead of `asChild`

base-ui has no `asChild` prop. To render a primitive **as** another element (the
classic "link that looks like a button" pattern), pass a `render` prop with a JSX
element. You can see this throughout the codebase:

```tsx
// app-sidebar.tsx — a sidebar button that is actually a <Link>
<SidebarMenuButton render={<Link href={item.href} />} isActive={…} tooltip={…}>
  <item.icon className="size-4" />
  <span>{item.title}</span>
</SidebarMenuButton>

// app-topbar.tsx — breadcrumb link
<BreadcrumbLink render={<Link href="/" />}>Servio</BreadcrumbLink>
```

The same prop is used inside the primitives themselves, e.g. `DialogPrimitive.Close render={<Button variant="outline" />}` in `dialog.tsx`.
If you write `asChild`, it will silently do nothing. `Button`
([`components/ui/button.tsx`](../components/ui/button.tsx)) also accepts `render`
because it wraps `@base-ui/react/button`; the shared
[`link-button.tsx`](../components/link-button.tsx) exists precisely to give you a
`<Button>`-styled `<Link>` without repeating `render` boilerplate.

### Gotcha 2 — `Select` needs `items` for typeahead/value display

base-ui's `Select` behaves differently from Radix: the root needs an `items`
prop (value → label) so the trigger can show the selected label and typeahead
works. The shadcn `select` primitive is **not currently scaffolded** into
`components/ui/`; if you add it with the CLI, pass `items` to the root in
addition to rendering `<SelectItem>`s. Servio's forms and filters instead use the
searchable [`Combobox`](#shared-composite-components) /
[`ComboField`](#shared-composite-components) (which submits a plain hidden
input) and `ListToolbar`, so no `items` plumbing is needed there.

When documenting or debugging any base-ui-specific behaviour, verify against the
installed version rather than memory — the API moved between betas.

### The chat UI is assistant-ui (base-ui flavour)

The **Sable** assistant's chat surface is not hand-rolled — it is built on
[**assistant-ui**](https://assistant-ui.com) (`@assistant-ui/react` +
`@assistant-ui/react-ai-sdk`), scaffolded in the **base-ui** flavour so its
primitives match the rest of the design system. The scaffolded Thread lives in
[`components/thread.tsx`](../components/thread.tsx) alongside its supporting parts
(`markdown-text`, `reasoning`, `tool-fallback`, `tool-group`,
`tooltip-icon-button`, `attachment`, `follow-up-suggestions`), and markdown
rendering uses `react-markdown` + `remark-gfm`. The composer send button and
caret are retinted to the `--sable` accent so the chat reads as an AI surface.

---

## Primitive library (`components/ui/`)

Generated shadcn/base-ui primitives. Import via the `@/components/ui/*` alias.
Current set:

`ai-button`, `alert`, `avatar`, `breadcrumb`, `button`, `calendar`, `card`,
`checkbox`, `collapsible`, `command`, `dialog`, `dropdown-menu`, `input`,
`input-group`, `label`, `popover`, `rich-text-editor` (with its
`mention-extension.ts` helper), `separator`, `sheet`, `sidebar`, `skeleton`,
`sonner`, `switch`, `table`, `tabs`, `textarea`, `tooltip`.

Notes:

- **`button.tsx`** — `cva` variants: `default`, `outline`, `secondary`, `ghost`,
  `destructive`, `link`; sizes `xs`/`sm`/`default`/`lg` plus `icon`,
  `icon-xs`/`sm`/`lg`. Note `destructive` is a **tinted** style (`bg-destructive/10
  text-destructive`), not a solid red fill.
- **`ai-button.tsx`** — `Button` (outline, `sm`) with the monochrome `--sable` tint; use it for AI affordances.
- **`sonner.tsx`** — toast host. Mounted once in the root layout as
  `<Toaster richColors position="top-right" />`; call `toast(...)` from client code.
- **`sidebar.tsx`** — the full shadcn sidebar system (provider, inset, trigger,
  collapsible-to-icon rail). Powers the console shell.
- **`rich-text-editor.tsx`** — a **Tiptap** (StarterKit + Placeholder + `@mention`)
  editor that submits sanitised HTML via a hidden input `name`; used for ticket
  comments/descriptions. Not a plain shadcn primitive.
- **`table.tsx`** — low-level table parts (`Table`, `TableHeader`, `TableRow`,
  `TableCell`, …). There is **no** `DataTable` abstraction; list pages compose
  these primitives directly together with [`ListToolbar`](#shared-composite-components)
  and [`PaginationBar`](#shared-composite-components).

---

## Shared composite components

Higher-level, app-specific components live directly in `components/` (not
`components/ui/`). These are the building blocks every module page reuses.

| Component | File | Purpose |
|-----------|------|---------|
| `Logo` / `BrandName` / `Wordmark` | [`components/brand.tsx`](../components/brand.tsx) | Relay symbol, outlined wordmark for either brand, and Servio lockup with optional subtitle. |
| `SableMark` | [`components/sable-mark.tsx`](../components/sable-mark.tsx) | Filled Nova Flow SVG, inheriting current colour; optional Cobalt/Ice `accent`, SVG props and forwarded ref. |
| `ThemeToggle` | [`components/theme-toggle.tsx`](../components/theme-toggle.tsx) | Ghost icon button that flips light/dark via next-themes' `resolvedTheme`. |
| `PageHeader` / `PageBody` | [`components/page-header.tsx`](../components/page-header.tsx) | Standard page title bar (optional icon, description, right-aligned action slot) and padded body wrapper. |
| `StatCard` | [`components/stat-card.tsx`](../components/stat-card.tsx) | Dashboard KPI tile: big `tabular-nums` value, label, optional hint, icon tone, optional link. Tones: `primary`/`success`/`warning`/`danger`/`muted`. |
| `EmptyState` | [`components/empty-state.tsx`](../components/empty-state.tsx) | Dashed-border centred placeholder for empty lists (icon, title, description, action slot). |
| `LocalTime` / `timeAgo` | [`components/local-time.tsx`](../components/local-time.tsx) | Time text in a client component that depends on the viewer's clock or zone ("3 minutes ago", a local date). Renders after hydration, so server and browser never disagree (React error #418). Use it instead of calling `formatDistanceToNow`/`format` directly in client render. |
| `ToneBadge` / `StatusBadge` | [`components/status-badge.tsx`](../components/status-badge.tsx) | Pill badge driven by a `Meta` (`StatusBadge` looks the meta up from a map + value). See [Status conventions](#status--priority-conventions). |
| `PriorityDot` | [`components/status-badge.tsx`](../components/status-badge.tsx) | Small coloured dot for compact priority/status signalling (takes a `Tone`). |
| `VipBadge` | [`components/status-badge.tsx`](../components/status-badge.tsx) | Gold crown badge for VIP requesters. |
| `Combobox` | [`components/combobox.tsx`](../components/combobox.tsx) | Searchable popover select (Popover + Command). Supports icons, tones, and stacked avatar/hint rows for people. |
| `ComboField` | [`components/combo-field.tsx`](../components/combo-field.tsx) | Form-friendly `Combobox` that manages its own state and submits via a hidden `name` input — the drop-in replacement for `<Select name=…>` in `useActionState` forms. Optional `— None —` entry. |
| `ListToolbar` | [`components/list-toolbar.tsx`](../components/list-toolbar.tsx) | List-page toolbar: debounced search + filter comboboxes that push to URL `searchParams` (via `router.push`), a Clear button, and a right-aligned action slot. |
| `PaginationBar` | [`components/pagination-bar.tsx`](../components/pagination-bar.tsx) | Server-rendered "from–to of total" + prev/next, using `buildHref` from [`lib/query.ts`](../lib/query.ts) so paging stays URL-driven. |
| `CommandMenu` | [`components/command-menu.tsx`](../components/command-menu.tsx) | `⌘K` / `/` global search palette. Debounced server search against `/api/search`, grouped results, plus quick-actions and role-filtered nav when empty. |
| `CreateMenu` | [`components/create-menu.tsx`](../components/create-menu.tsx) | Topbar "+" dropdown of create shortcuts. |
| `UserMenu` / `UserAvatar` | [`components/user-menu.tsx`](../components/user-menu.tsx), [`components/user-avatar.tsx`](../components/user-avatar.tsx) | Account dropdown (profile/sign-out) and initials/image avatar. |
| `ConfirmButton` / `ConfirmDialog` | [`components/confirm-dialog.tsx`](../components/confirm-dialog.tsx) | `ConfirmButton` is a trigger button that opens a confirmation dialog before running a (destructive) server action; `ConfirmDialog` is the controlled variant for menu items. Use these, never native `window.confirm()`. |
| `EditEntityDialog` | [`components/edit-entity-dialog.tsx`](../components/edit-entity-dialog.tsx) | Reusable inline entity-edit dialog. |
| `charts` | [`components/charts.tsx`](../components/charts.tsx) | Dashboard chart wrappers keyed to the `--chart-1…5` tokens. |

> URL-as-state: `ListToolbar`, `PaginationBar`, and the filter comboboxes all read
> from and write to `searchParams`, so list state is shareable and server-rendered.
> This is the canonical list pattern — reuse it rather than inventing client-side
> filtering.

---

## Status & priority conventions

**All** enum-like fields (statuses, priorities, types, roles, sync states, …)
resolve their label, colour, and icon through
[`lib/constants.ts`](../lib/constants.ts) — the single source of truth. SQLite has
no native enums, so these are string fields with a companion `*_META` map. (Note:
the domain constants live here in `lib/constants.ts`, **not** in any `lib/enums.ts`.)

The colour system is a small closed set of **tones**, each with a Tailwind class
string in `TONE_CLASSES`:

| Tone | Palette (tint / text / border) |
|------|-------------------------------|
| `neutral` | `muted` fill, `muted-foreground` text |
| `info` | sky |
| `success` | emerald |
| `warning` | amber |
| `danger` | red |
| `purple` | purple |
| `indigo` | indigo |

Each domain exports its allowed values plus a `Record<string, Meta>` where
`Meta = { label; tone; icon? }`. Examples:

```ts
export type Meta = { label: string; tone: Tone; icon?: LucideIcon };

TICKET_STATUS_META.IN_PROGRESS // { label: "In Progress", tone: "purple", icon: PlayCircle }
PRIORITY_META.CRITICAL         // { label: "Critical", tone: "danger", icon: Flame }
```

To render one, hand the map + raw value to `StatusBadge`, which uses `metaFor`
(returns a neutral `—` fallback for null/unknown keys):

```tsx
import { StatusBadge } from "@/components/status-badge";
import { TICKET_STATUS_META, PRIORITY_META } from "@/lib/constants";

<StatusBadge map={TICKET_STATUS_META} value={ticket.status} />
<StatusBadge map={PRIORITY_META} value={ticket.priority} />
```

Domains currently covered include: roles, ticket type/status/priority,
impact/urgency, source, pending reasons, resolution codes, problem status, change
type/status, risk, approvals, service status, criticality, auto-assign strategy,
group type, asset type/status/relation, sync type/direction/scope/run-status, SLA
clock state, KB article status/visibility, and location type. Human-facing
reference numbers are generated by helpers in the same file: `ticketRef` (`INC-`
/ `REQ-`), `problemRef` (`PRB-`), `changeRef` (`CHG-`), all zero-padded to 4
digits.

> When you add a new status/type value, add it to the `as const` array **and** its
> `*_META` map in `lib/constants.ts`. Never hard-code a colour or label at the call
> site.

---

## The two shells

Servio has two distinct layouts, matching its two audiences (see
[architecture.md](./architecture.md#️-route-groups--layout-tree) for routing details):

### Agent console — sidebar + topbar

`app/(console)/layout.tsx` wraps the agent
experience. It gates on `requireRole("AGENT")`, then renders a
`SidebarProvider` → `AppSidebar` + `SidebarInset(AppTopbar + main)`.

- **[`AppSidebar`](../components/app-sidebar.tsx)** — collapsible-to-icon
  (`collapsible="icon"`) rail with the `Logo`/wordmark header and role-filtered nav
  groups from [`lib/nav.ts`](../lib/nav.ts) (`consoleNav` + `filterNav`). Active
  state is derived from `usePathname`.
- **[`AppTopbar`](../components/app-topbar.tsx)** — sticky, blurred bar with a
  sidebar trigger, breadcrumb built from the path (numeric segments become
  `#123`, cuid-like ids collapse to "Details"), and the right cluster:
  `CommandMenu`, `CreateMenu`, a notifications bell with unread count, `ThemeToggle`,
  and `UserMenu`.
- **Split-pane detail pages** (ticket, asset, change, … and `/assistant`) mark their
  root with `data-viewport-pane` and size it `lg:h-full`, with `lg:min-h-0
  lg:overflow-y-auto` on each pane. The layout then locks `SidebarInset` to the
  viewport for that page only, so the panes fill whatever the topbar and banners
  leave. Never size a pane as `calc(100svh - …)`: any banner makes the page taller
  than the viewport and adds a window scrollbar on top of the pane scrollbars.

### Self-service portal — centred column

[`app/portal/layout.tsx`](../app/portal/layout.tsx) is the end-user help center.
It gates on `requireUser()` (any authenticated user) and renders a simple
centred column: a sticky header with the `Wordmark` (subtitle "Help Center"), a
centered `PortalNav`, and a right cluster containing an "Agent console" shortcut
(only when `isAgent(user.role)`), `ThemeToggle`, and `UserMenu`. Content is
constrained to `max-w-6xl` with a muted page background (`bg-muted/30`) and a
footer. No sidebar.

Both shells share the same tokens, fonts, badges, and `ThemeToggle`, so a
component written for one generally looks correct in the other.
