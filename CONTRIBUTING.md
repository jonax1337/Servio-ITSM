# Contributing to Servio

Thanks for contributing to **Servio**, an open-source ITSM platform (a modern GLPI alternative). This guide is the single entry point for anyone — human or AI agent — adding features to the codebase. Read it in full before your first change.

Servio is built with **Next.js 16** (App Router, React 19, Turbopack), **Prisma 6**, **Auth.js v5**, **base-ui / shadcn** (Tailwind v4), and **Zod 4**. The package manager is **pnpm**.

> New here? Skim the [docs index](docs/README.md) and [architecture overview](docs/architecture.md) first, then come back for the workflow.

---

## 🔑 The golden rule: this is *not* the Next.js you know

Servio pins **Next.js 16**, which has breaking changes versus older versions many contributors (and LLMs) have in muscle memory. APIs, conventions, and file structure may differ from what you expect.

**Before writing any framework-level code, read the real docs shipped in the repo:**

```
node_modules/next/dist/docs/
```

These are resolved relative to the package, so in this repo look under `node_modules/next/dist/docs/`. Heed every deprecation notice you find there. This directive lives in [`AGENTS.md`](AGENTS.md) and is non-negotiable — do not rely on memory for Next.js 16, Auth.js v5, Prisma 6, or base-ui behavior. When in doubt, verify against the docs or the existing code.

**Match the existing code exactly.** The fastest way to be correct is to copy the shape of a working module. Servio's reference implementation is the **Tickets** module — study it before writing anything (see below).

### `AGENTS.md` is machine-managed

`next dev` re-writes a block into [`AGENTS.md`](AGENTS.md) (via `node_modules/next/dist/server/lib/generate-agent-files.js`). Deleting it from a diff only recreates the uncommitted change. If it changed as part of your work, **commit it** so the tree stays clean.

---

## Dev environment (quick start)

Full setup, environment variables, and troubleshooting live in [docs/development.md](docs/development.md). The short version:

```bash
pnpm install
cp .env.example .env        # then fill in the values
pnpm db:migrate             # apply migrations to the SQLite dev DB
pnpm db:seed                # seed demo data
pnpm dev                    # start Next.js (Turbopack) on http://localhost:3000
```

Useful scripts from [`package.json`](package.json):

| Script | What it does |
|---|---|
| `pnpm dev` | Run the dev server (`next dev`, Turbopack) |
| `pnpm build` | Production build — **must pass before you open a PR** |
| `pnpm lint` | ESLint (`eslint-config-next`) — **must pass before you open a PR** |
| `pnpm test:e2e` | Playwright link crawl per role against a built app on :3200 (needs `pnpm build` and a seeded DB, see [CI & releases](docs/releasing.md#-link-integrity-tests)) |
| `pnpm brand:check` | Verify application logos, icons, metadata images and brand tokens |
| `pnpm brand:sync` | Regenerate application copies after updating the canonical brand kit |
| `pnpm db:migrate` | `prisma migrate dev` — create/apply a dev migration |
| `pnpm db:push` | Push schema without a migration (prototyping only) |
| `pnpm db:seed` | Seed via `prisma/seed.ts` + `prisma/seed-extras.ts` |
| `pnpm db:reset` | `prisma migrate reset --force` (drops + reseeds) |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm db:generate` | Regenerate the Prisma client |

The dev database is SQLite (`prisma/dev.db`). Production targets Postgres — keep both in mind (see [Gotchas](#-gotchas)).

---

## Project layout you need to know

Servio has **no `src/` directory**. Routes live directly under `app/`:

| Path | Purpose |
|---|---|
| `app/(console)/*` | The agent console (staff-facing). Route group, not part of the URL. |
| `app/portal/*` | The self-service end-user portal. |
| `app/login` | Auth pages. |
| `app/api/*` | Route handlers, including the public REST API. |
| `lib/` | Server + shared logic: `actions/`, `data/`, `constants.ts`, `db.ts`, `session.ts`, `audit.ts`, `query.ts`, `nav.ts`. |
| `components/` | Shared UI (`components/ui/*` = base-ui/shadcn primitives) and per-module component folders (`components/tickets/*`). |
| `prisma/` | `schema.prisma`, migrations, seeds. |
| `proxy.ts` | The middleware (Next 16 names it `proxy.ts`, **not** `middleware.ts`). |

> The project structure has evolved over time. If you find an older reference to a `src/` directory, `(auth)`/`(portal)` route groups, or a `middleware.ts`, it is stale — the current layout is the one above. **Trust the code and [docs/](docs/README.md), not older notes.**

---

## Canonical reference files — read these before writing a module

Every module follows the Tickets pattern. Open these first:

| File | Pattern it demonstrates |
|---|---|
| `app/(console)/tickets/page.tsx` | List page: filters, table, pagination, `force-dynamic` |
| `app/(console)/tickets/[id]/page.tsx` | Detail page: async `params`, right-column property cards |
| `app/(console)/tickets/new/page.tsx` | Create page wrapping the form |
| [`components/tickets/ticket-form.tsx`](components/tickets/ticket-form.tsx) | Create form: `useActionState`, `ComboField` |
| [`components/tickets/ticket-properties.tsx`](components/tickets/ticket-properties.tsx) | Inline-edit pattern: `Combobox` + `useTransition` firing a server action |
| [`lib/actions/tickets.ts`](lib/actions/tickets.ts) | Server actions: `"use server"`, Zod, audit, notify, revalidate/redirect |
| [`lib/constants.ts`](lib/constants.ts) | All status/label/tone/icon maps + ref helpers (the "enum" source of truth) |
| [`lib/data/options.ts`](lib/data/options.ts) | Cached option lists for selects & filters (`getFormOptions`) |
| [`lib/query.ts`](lib/query.ts) | `getParam` / `getPage` / `PAGE_SIZE` / `buildHref` for URL-driven lists |
| [`lib/nav.ts`](lib/nav.ts) | Sidebar navigation groups + role gating |
| [`lib/session.ts`](lib/session.ts) | `getSessionUser`, `requireUser`, `isAgent`, `Role` |
| [`lib/audit.ts`](lib/audit.ts) | `writeAudit(...)`, `notify(...)` |
| [`prisma/schema.prisma`](prisma/schema.prisma) | Exact model + field names |

Shared UI you should reuse rather than reinvent: `components/page-header.tsx` (`PageHeader`/`PageBody`), `components/link-button.tsx`, `components/list-toolbar.tsx`, `components/pagination-bar.tsx`, `components/status-badge.tsx`, `components/empty-state.tsx`, `components/stat-card.tsx`, `components/combobox.tsx`, `components/combo-field.tsx`, and `components/ui/*`.

---

## Recipe: add a new module

This walks the same layers the Tickets module is built from. Say you're adding a `Widget` module.

### 1. Schema + migration

Add the model to [`prisma/schema.prisma`](prisma/schema.prisma), matching the naming conventions of existing models. Note the id conventions:

- `Ticket`, `Problem`, `Change` use an **`Int @id @default(autoincrement())`** and are displayed via ref helpers (`ticketRef`, `problemRef`, `changeRef`).
- Everything else uses a **cuid string id**.

Then create the migration:

```bash
pnpm db:migrate       # prisma migrate dev — name it, commit the generated files
```

Commit the SQL under `prisma/migrations/` together with the schema change.

### 2. Enum-like fields → `lib/constants.ts`

SQLite has no native enums, so status/type/priority fields are **plain `String` columns**. Their allowed values, human labels, badge tone, and icon live in [`lib/constants.ts`](lib/constants.ts). Follow the existing block shape:

```ts
export const WIDGET_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const WIDGET_STATUS_META: Record<string, Meta> = {
  ACTIVE:   { label: "Active",   tone: "success", icon: CircleCheck },
  ARCHIVED: { label: "Archived", tone: "neutral", icon: CircleSlash },
};
```

Use `metaFor(map, value)` for safe lookups and reuse the shared `StatusBadge` for rendering. `constants.ts` is a shared file — only add your new maps; do not restructure existing ones.

### 3. Server actions → `lib/actions/`

Create `lib/actions/widgets.ts` mirroring [`lib/actions/tickets.ts`](lib/actions/tickets.ts):

- `"use server";` at the top of the file.
- Import the Prisma client as `import { db } from "@/lib/db"`. Accessors are camelCased model names (`db.widget`, `db.ticket`, and note the SLA accessor is **`db.sLA`** — capital `LA`). Types come from `import type { Prisma } from "@prisma/client"`.
- Authorize with `getSessionUser()` / `isAgent()` from `@/lib/session` (Tickets wraps this in a `requireAgent()` helper).
- Validate input with **Zod** (`z.enum(WIDGET_STATUSES)`, etc.).
- Two shapes of action:
  - **Create** returns an `ActionState` for `useActionState` and ends with `revalidatePath(...)` + `redirect(...)`.
  - **Inline field updates** take a `FormData`, patch one field, `writeAudit({...})` / `notify(...)`, then `revalidatePath(...)`.

```ts
"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser, isAgent, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { WIDGET_STATUSES } from "@/lib/constants";

export type ActionState = { error?: string; fieldErrors?: Record<string, string[]> } | undefined;

const createSchema = z.object({
  name: z.string().min(3),
  status: z.enum(WIDGET_STATUSES).default("ACTIVE"),
});

export async function createWidget(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await getSessionUser();
  if (!me || !isAgent(me.role as Role)) return { error: "Not authorised" };
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  const widget = await db.widget.create({ data: parsed.data });
  await writeAudit({ userId: me.id, action: "CREATE", entity: "Widget", entityId: widget.id, summary: `Created "${widget.name}"` });
  revalidatePath("/widgets");
  redirect(`/widgets/${widget.id}`);
}
```

> Share the Zod schema between the server action and the corresponding REST endpoint so validation is defined once. See [docs/rest-api.md](docs/rest-api.md).

### 4. Pages under `app/(console)/widgets/`

Create three pages, copying the Tickets layout precisely:

- **`page.tsx`** (list) — `PageHeader`/`PageBody` → `ListToolbar` (filters) → either `EmptyState` or a `rounded-xl border bg-card` `Table` → `PaginationBar`. Read filters with `getParam` and paginate with `getPage`/`PAGE_SIZE`.
- **`[id]/page.tsx`** (detail) — back `LinkButton`, title, status badges, a main card plus a right column of property cards (inline-edit `Combobox` where editable, read-only rows otherwise).
- **`new/page.tsx`** (create) — thin wrapper that fetches `getFormOptions()` and renders the client form.

**Next 16 page rules (verify in `node_modules/next/dist/docs/`):**

- `params` and `searchParams` are **Promises** — type them `{ params: Promise<{ id: string }> }` / `{ searchParams: Promise<SearchParams> }` and `await` them.
- Add `export const dynamic = "force-dynamic";` to every page that reads the DB.

### 5. Components under `components/widgets/`

Put module UI here. The create form is a client component using `useActionState`:

```tsx
"use client";
import { useActionState } from "react";
import { createWidget, type ActionState } from "@/lib/actions/widgets";
const [state, action, pending] = useActionState<ActionState, FormData>(createWidget, undefined);
// <form action={action}> …
```

Inline-edit controls are client components that fire the FormData action inside a `useTransition` (see [`ticket-properties.tsx`](components/tickets/ticket-properties.tsx)). Toasts use `import { toast } from "sonner"`.

### 6. Navigation entry → `lib/nav.ts`

Add your route to the correct `NavGroup` in [`lib/nav.ts`](lib/nav.ts), with a lucide icon and an optional `minRole` gate:

```ts
{ title: "Widgets", href: "/widgets", icon: Boxes, minRole: "AGENT" },
```

### 7. Option lists → `lib/data/options.ts`

If your forms/filters need dropdowns of other entities (agents, groups, categories…), extend `getFormOptions()` in [`lib/data/options.ts`](lib/data/options.ts) — it is a `cache()`-wrapped batch query returning the `FormOptions` type.

### 8. Documentation → `docs/**` + the drift map

Docs are part of the change, not a follow-up. Add your module to [docs/modules.md](docs/modules.md) (and any other doc your code touches), then register its ownership in the `DOC_MAP` in [`scripts/check-doc-drift.mjs`](scripts/check-doc-drift.mjs) so future edits to it are gated. Run `/sync-docs` (or `pnpm run docs:check`) before committing. See [docs/maintaining-docs.md](docs/maintaining-docs.md) for how the three doc-sync layers work.

See [docs/modules.md](docs/modules.md) for the full catalog of existing modules and how they fit together.

---

## ⚠️ Gotchas

These trip up almost everyone (and every LLM) on their first change:

- **base-ui composes with `render`, not `asChild`.** There is no `asChild` prop. For a link styled as a button use `<LinkButton href="…">`. For breadcrumb/menu/sidebar links use `render={<Link href="…" />}`. A base-ui `<Button>` rendered as a link needs `nativeButton={false}` — so prefer `LinkButton`.
- **base-ui `Select` needs an `items` prop.** When you use the raw `Select` from `@/components/ui/select`, base-ui requires an `items` map (value → label) so the trigger can show the selected label:
  ```ts
  items={{ none: "—", ...Object.fromEntries(opts.map((o) => [o.value, o.label])) }}
  ```
  In practice, Tickets uses the higher-level `Combobox` / `ComboField` wrappers ([`components/combobox.tsx`](components/combobox.tsx), [`components/combo-field.tsx`](components/combo-field.tsx)) which handle this for you — prefer those. For **list filters**, use the shared `ListToolbar` instead of a bare Select.
- **Prisma 6 accessors are camelCased model names.** `db.ticket`, `db.problem`, `db.change`, `db.asset`, `db.group`, `db.user`, `db.auditLog`, … and the SLA accessor is **`db.sLA`** (capital `LA`).
- **SQLite has no `mode: "insensitive"`.** Text search is `where: { field: { contains: q } }`. Keep queries portable to Postgres for production.
- **"Enums" are String-backed.** Never assume a Prisma enum type — validate against the `*_STATUSES`/`*_TYPES` arrays in [`lib/constants.ts`](lib/constants.ts) (with `z.enum(...)`) and render with the matching `*_META` map.
- **Int-id vs cuid-id models.** `Ticket`/`Problem`/`Change` have Int ids shown via `ticketRef`/`problemRef`/`changeRef`; coerce route params with `Number(id)` and guard with `Number.isFinite`. All other models use string cuids.
- **Server actions must revalidate.** After a mutation, `revalidatePath` the list and the detail route, or the UI will show stale data.

---

## Code style

- **TypeScript, strict.** No `any`, no unused imports, no unused vars. Every page and component must type-check and build.
- **ESLint** via `eslint-config-next` — run `pnpm lint` and fix all findings.
- **Zod for all input validation**, shared between server actions and REST handlers.
- **Match existing spacing/typography.** Pages use `PageHeader`/`PageBody`; cards are `rounded-xl border bg-card`. Reuse shared components; don't hand-roll one-offs.
- **Only create files inside your module's paths.** Do not edit `components/ui/*`, unrelated modules, or restructure shared files. For `lib/constants.ts` and `lib/nav.ts`, only append your module's additions.

---

## Commits & pull requests

Before opening a PR, both of these **must pass locally**:

```bash
pnpm lint
pnpm build
```

[CI](docs/releasing.md) runs them on every PR together with the typecheck, the unit
tests, the migration-drift check, the `pnpm test:e2e` link crawl and a Docker build.

PR expectations:

- Write commit messages as [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat(scope): …`, `fix: …`, `docs: …`). PR titles end up in the generated
  release notes, so write them for users.

- One logical change per PR; keep diffs focused.
- Commit generated Prisma migrations alongside schema changes.
- If `next dev` re-added its block to [`AGENTS.md`](AGENTS.md), commit that too so the tree is clean.
- Describe what changed and how you verified it. Link related issues.
- New user-facing behavior should be reflected in the relevant `docs/` page.

---

## Where to go next

Identity changes use the [brand kit](branding/README.md) and
[integration reference](docs/branding.md). Reuse Relay and Nova Flow through
the shared components, with local Manrope display type and Inter for dense UI.
Include regenerated application assets and update the design-system reference.

- [docs/README.md](docs/README.md) — documentation index
- [docs/architecture.md](docs/architecture.md) — how the app fits together
- [docs/development.md](docs/development.md) — full dev environment setup
- [docs/modules.md](docs/modules.md) — the module catalog
- [docs/ai.md](docs/ai.md) — Sable, the built-in AI agent (providers, privacy gate, approve-first flow)
- [docs/data-model.md](docs/data-model.md) · [docs/rest-api.md](docs/rest-api.md) · [docs/design-system.md](docs/design-system.md) · [docs/configuration.md](docs/configuration.md) · [docs/deployment.md](docs/deployment.md)
