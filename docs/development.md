# Development Guide

Everything you need to run Servio locally, understand the project layout, and write
code that matches the conventions the rest of the codebase (and the AI agents working
in it) already follow.

> **Read this first — this is not the Next.js you may know.**
> Servio runs **Next.js 16** (App Router, React 19, Turbopack). Framework APIs, file
> conventions, and naming differ from older releases. `next dev` writes an [`AGENTS.md`](../AGENTS.md)
> block to the repo instructing you to read the bundled docs under
> `node_modules/next/dist/docs/` **before writing framework code**, and to heed
> deprecation notices. When in doubt about Next.js 16 / Auth.js v5 / Prisma 6 / base-ui
> behavior, verify against those bundled docs (or Context7) rather than memory.

See also: [architecture.md](./architecture.md) · [configuration.md](./configuration.md) ·
[../CONTRIBUTING.md](../CONTRIBUTING.md)

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | **24.x LTS (≥ 24.22.1)** | What CI and both images run. `package.json#engines` enforces it, because `officeparser` and `unpdf` need it; `@types/node` is pinned to `^24`. |
| **pnpm** | **11.x** | The repo declares `"packageManager": "pnpm@11.0.8"`. Use pnpm — not npm/yarn — so the lockfile and workspace settings stay consistent. |
| Git | any recent | — |
| SQLite | bundled | Dev uses a local SQLite file (`DATABASE_URL="file:./dev.db"`); no separate DB server needed. Postgres is the production target — see [configuration.md](./configuration.md). |

Install pnpm via Corepack if you don't have it:

```bash
corepack enable
corepack prepare pnpm@11.0.8 --activate
```

---

## Quickstart (first run)

> **Just want to run Servio?** You don't need the source: the published Docker images
> start with one `docker compose` command — see the [README quick start](../README.md#quick-start)
> and [deployment.md](./deployment.md#-docker). This page is for working on the code.

```bash
pnpm install                  # install dependencies
cp .env.example .env          # copy the environment template
npx auth secret               # generates AUTH_SECRET — paste it into .env
pnpm db:migrate               # create the SQLite schema from prisma/migrations
pnpm db:seed                  # load rich demo data (users, tickets, assets, catalog…)
pnpm dev                      # http://localhost:3000 (Turbopack)
```

`.env.example` is fully commented; the only value you **must** set is `AUTH_SECRET`.
`DATABASE_URL` already points at a local SQLite file, and SMTP/OIDC/storage are all
optional (empty = disabled / dev-friendly fallbacks). Full variable reference:
[configuration.md](./configuration.md).

> On Windows, run these in Git Bash or PowerShell. `cp` exists in Git Bash; in
> PowerShell use `Copy-Item .env.example .env`.

### Demo credentials

The seed (`prisma/seed.ts`) creates every user with the password **`servio123`**.
All accounts live on the `@servio.dev` domain:

| Login | Role | See |
|-------|------|-----|
| `admin@servio.dev` | ADMIN | Full agent console + Settings |
| `mara@servio.dev` | MANAGER | Manager view |
| `sam@servio.dev` | AGENT | Service-desk agent console |
| `liam@servio.dev` | USER | The `/portal` self-service experience |

Password for all of the above: **`servio123`**.

### Demo API token

The seed also provisions a personal access token owned by `admin@servio.dev`:

```
servio_demo_pat_0123456789abcdef
```

Use it against the public REST API (see [rest-api.md](./rest-api.md)):

```bash
curl "http://localhost:3000/api/v1/tickets?status=open" \
  -H "Authorization: Bearer servio_demo_pat_0123456789abcdef"
```

Tokens are stored **hashed** (bcrypt); the raw value only exists in the seed and in the
UI at the moment of creation (Settings › API Tokens).

---

## Scripts

All scripts live in [`package.json`](../package.json) and are run with `pnpm <script>`.

| Script | Command | What it does |
|--------|---------|--------------|
| `dev` | `next dev` | Start the dev server (Turbopack) on port 3000. |
| `build` | `brand:check && next build` | Validate brand assets, then the production build. |
| `start` | `next start` | Serve the production build. |
| `lint` | `eslint` | Lint with the flat ESLint config (`eslint.config.mjs`). |
| `typecheck` | `next typegen && tsc --noEmit` | Generate route types, then type-check. |
| `test` / `test:watch` | `vitest run` / `vitest` | Unit tests (`tests/unit`). |
| `test:e2e` | `playwright test` | Link-crawl E2E against a production build — see [releasing.md](./releasing.md#-link-integrity-tests). |
| `docs:check` | `node scripts/check-doc-drift.mjs --working` | Report code changes whose owning doc was not updated ([maintaining-docs.md](./maintaining-docs.md)). |
| `brand:check` / `brand:sync` | `node scripts/sync-brand-assets.mjs [--check]` | Validate / regenerate application brand assets ([branding.md](./branding.md)). |
| `db:generate` | `prisma generate` | Regenerate the Prisma Client after schema changes. |
| `db:migrate` | `prisma migrate dev` | Create/apply a dev migration from `prisma/schema.prisma`. |
| `db:push` | `prisma db push` | Push schema to the DB without a migration (prototyping). |
| `db:seed` | `prisma db seed` | Run the seed (`tsx prisma/seed.ts`, which also runs `prisma/seed-extras.ts`) on an **empty** database. |
| `db:reset` | `prisma migrate reset --force` | Drop, re-migrate, and reseed the database. |
| `db:studio` | `prisma studio` | Open Prisma Studio (visual DB browser). |
| `setup` | `prisma migrate deploy && prisma db seed` | Non-interactive migrate + seed (CI / production bootstrap). |

The seed entrypoint is configured under the `prisma.seed` key in `package.json`:
`prisma/seed.ts` (core users, groups, tickets, catalog) calls `seedExtras()` from
`prisma/seed-extras.ts` when it is done. The seed starts by deleting all data, so it
**refuses** (logs, skips, exits 0) when the database already holds users or tickets
([`prisma/seed-guard.ts`](../prisma/seed-guard.ts)). To start over with fresh demo data use
`pnpm db:reset`, which drops the database first.

---

## Project layout

There is **no `src/` directory** — application code lives at the repo root. TypeScript
path alias `@/*` maps to the project root (see `tsconfig.json`), so imports look like
`@/lib/db`, `@/components/ui/button`.

```text
app/
  (console)/          Agent console — a route group (URL has no "(console)" segment).
                      Dashboard (page.tsx), shared layout.tsx (sidebar + topbar), and
                      one folder per module: tickets/ problems/ changes/ releases/
                      assets/ contracts/ catalog/ services/ groups/ people/
                      categories/ locations/ knowledge/ approvals/ automations/
                      syncs/ oncall/ status/ insights/ audit/ assistant/ settings/
  portal/             Self-service portal for end users (USER role).
  login/              Auth pages (Credentials + optional "Continue with SSO").
  maintenance/        Maintenance page served by proxy.ts during a blocking window.
  survey/             Public one-time CSAT survey.
  api/
    auth/[...nextauth]/route.ts   Auth.js handler
    v1/                           Public, versioned REST API (Bearer-token auth)
      tickets/  assets/  services/  openapi/  _serializers.ts
    assistant/  ai/  portal/      Sable (console + portal) chat and AI endpoints
    files/                        Attachment upload/download route handlers
    search/  export/  dashboard/  Global search, CSV export, dashboard widget data
    maintenance/                  Public maintenance-window status
  globals.css         Tailwind v4 + theme tokens.  layout.tsx  Root layout.

components/
  ui/                 shadcn/ui primitives wrapping base-ui (@base-ui/react).
  <module>/           Module-specific components (tickets/, assets/, changes/, …).
  *.tsx               Shared building blocks: page-header, list-toolbar, status-badge,
                      empty-state, command-menu, combobox, combo-field, user-avatar, …

lib/
  actions/            "use server" Server Actions — the app's own mutations, one file
                      per module (tickets.ts, assets.ts, changes.ts, …).
  data/               Read helpers for pages (e.g. options.ts → getFormOptions()).
  constants.ts        Single source of truth for every "enum" string field (see below).
  db.ts               Prisma client singleton (import { db }).
  session.ts          Auth/session helpers: getSessionUser, requireUser, requireRole,
                      isAgent, hasRole, type Role.
  api.ts              REST-API helpers: guard(), ok(), apiError(), paginate(), etc.
  audit.ts sla.ts transitions.ts automations.ts assignment.ts mail.ts markdown.ts
  files.ts storage.ts query.ts utils.ts …   Cross-cutting domain logic.

prisma/
  schema.prisma       Data model. datasource provider = "sqlite" (swap to postgresql
                      for prod — see deployment.md). "Enums" are String columns.
  migrations/         Committed migration history.
  seed.ts             Core demo data + login line (the seed entrypoint).
  seed-extras.ts      Additional demo data (called by seed.ts).
  seed-guard.ts       Refuses to seed a database that already holds data.

types/
  next-auth.d.ts      Module augmentation adding `role` to the Auth.js session/JWT.

auth.ts               NextAuth() instance + providers (Credentials, OIDC).
auth.config.ts        Edge-safe Auth.js config shared with the middleware.
proxy.ts              The middleware. (Next 16 names it proxy.ts, NOT middleware.ts.)
```

> **Groups are the organizational unit.** The old Queues/Board module and the `Queue`
> model were removed — assignment and auto-routing run entirely on Groups
> (`lib/actions/groups.ts`, `app/(console)/groups/`). Freeform ticket Tags were removed too.

---

## Core conventions

Follow these — they're what the whole codebase does, and they're what an AI agent should
pattern-match on.

### Server Actions vs. Route Handlers

Servio has **two distinct write surfaces**, and they don't overlap:

| | Server Actions | Route Handlers |
|-|----------------|----------------|
| Location | `lib/actions/*.ts` (`"use server"`) | `app/api/v1/**/route.ts` |
| Consumers | The app's own UI (forms, buttons) | External clients (the public REST API) |
| Auth | Session cookie via `getSessionUser()` / `requireAgent()` | Bearer token via `guard(req, "<resource>:read"\|"<resource>:write")` |
| Input | `FormData` parsed with Zod | JSON / query params parsed with Zod |
| Output | `ActionState` (`{ error?, fieldErrors? }`) + `revalidatePath()` | `ok()` / `apiError()` JSON responses |

**The app's own mutations are Server Actions. The outside world talks to Route Handlers.**
Both share the same Zod schemas and the same domain helpers (`lib/sla.ts`,
`lib/audit.ts`, `lib/assignment.ts`, …), so business rules stay in one place.

A Server Action follows this shape (from [`lib/actions/tickets.ts`](../lib/actions/tickets.ts)):

```ts
"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSessionUser, isAgent, type Role } from "@/lib/session";
import { TICKET_TYPES, PRIORITIES } from "@/lib/constants";

async function requireAgent() {
  const me = await getSessionUser();
  if (!me || !isAgent(me.role as Role)) return null;
  return me;
}

const createSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
  type: z.enum(TICKET_TYPES),
  priority: z.enum(PRIORITIES),
  // …
});

export type ActionState =
  | { error?: string; fieldErrors?: Record<string, string[]> }
  | undefined;

export async function createTicket(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const me = await requireAgent();
  if (!me) return { error: "Not authorised" };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  // …db.ticket.create, writeAudit, sendMail, then:
  revalidatePath("/tickets");
}
```

Pages call these via React's `useActionState` and native `<form>` elements. Route
Handlers set `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`,
call `guard()` for auth, and return `ok()`/`apiError()`. See [rest-api.md](./rest-api.md).

### Enums are `String` columns + `lib/constants.ts`

SQLite has no native enums, and Servio keeps schema portability (SQLite ↔ Postgres)
without migrations. So **every "enum" field is a `String` column** in `schema.prisma`,
and the allowed values, labels, badge tone, and icon live in
[`lib/constants.ts`](../lib/constants.ts):

```ts
export const TICKET_TYPES = ["INCIDENT", "REQUEST"] as const;
export const TICKET_TYPE_META: Record<string, Meta> = {
  INCIDENT: { label: "Incident", tone: "danger", icon: AlertTriangle },
  REQUEST:  { label: "Service Request", tone: "info", icon: Send },
};
```

- Validate with `z.enum(TICKET_TYPES)` in both Server Actions and Route Handlers.
- Render with the `*_META` maps (labels, `<StatusBadge>` tones, lucide icons).
- **Never** create a new enum in `schema.prisma` and **never** put constants in
  `lib/enums.ts` (it does not exist) — everything goes through `lib/constants.ts`.

### Data model & reads

- `import { db } from "@/lib/db"` — the singleton Prisma client. Never `new PrismaClient()`.
- Page-level read helpers live in `lib/data/` (e.g. `getFormOptions()` in
  [`lib/data/options.ts`](../lib/data/options.ts), wrapped in React `cache()`).
- Console pages are typically `export const dynamic = "force-dynamic"` and fetch with
  `Promise.all([...])` in the async server component.

Full schema walkthrough: [data-model.md](./data-model.md).

### UI: shadcn/ui on base-ui — two gotchas

Servio's `components/ui/` primitives are shadcn (`style: "base-nova"`, see
`components.json`) built on **base-ui** (`@base-ui/react`), **not** Radix. Two
differences bite people coming from Radix-era shadcn:

1. **There is no `asChild`. Use `render` instead.** base-ui composes via a `render`
   prop, so shadcn's `asChild` pattern becomes `render={<Comp />}`. There is not a
   single `asChild` in the codebase — grep confirms `render=` is what primitives like
   `dialog`, `sheet`, `dropdown-menu`, and `sidebar` use. Example (`components/ui/dialog.tsx`):
   ```tsx
   <DialogPrimitive.Close render={<Button variant="outline" />}>Close</DialogPrimitive.Close>
   ```

2. **base-ui `Select` needs its option data up front.** base-ui's `Select.Root` renders
   the trigger's selected label from an `items` list (a value→label mapping / options
   array), not by reading children — a bare `<Select>` will show a blank/placeholder
   trigger even with a valid value. In practice Servio sidesteps this for form selects
   by using the searchable [`ComboField`](../components/combo-field.tsx) /
   [`Combobox`](../components/combobox.tsx) components, which manage their own value and
   submit through a hidden `<input name=…>` so they drop straight into native
   `<form>` + `useActionState` flows. There is no `components/ui/select.tsx` today —
   reach for `ComboField` for form dropdowns, and if you scaffold the base-ui `Select`,
   always pass `items`.

More on tokens, tones, and primitives: [design-system.md](./design-system.md).

### A module at a glance (tickets)

Every console module follows the same skeleton — use tickets as the template:

| File | Responsibility |
|------|----------------|
| `app/(console)/tickets/page.tsx` | List view: `ListToolbar` filters, `Table`, `PaginationBar`, `EmptyState`. Reads via `db` + `getFormOptions()`. |
| `app/(console)/tickets/[id]/page.tsx` | Detail view: properties panel, activity thread, actions. |
| `app/(console)/tickets/new/page.tsx` | Create form — server component loads options, renders `<TicketForm>`. |
| [`lib/actions/tickets.ts`](../lib/actions/tickets.ts) | All ticket mutations (Server Actions) + Zod schemas. |
| [`components/tickets/`](../components/tickets/) | Client components: `ticket-form`, `ticket-properties`, `ticket-actions`, `comment-composer`, etc. |

Copy this structure for new modules; see [modules.md](./modules.md) for the full list.

---

## Editor / linting / type-checking

- **Lint:** `pnpm lint` (flat config `eslint.config.mjs`, extends
  `eslint-config-next` core-web-vitals + TypeScript rules).
- **Types:** `strict` is on (`tsconfig.json`), `noEmit` — type-check with `pnpm typecheck`
  or your editor's TS server. Path alias `@/*` → repo root.
- **Tests:** `pnpm test` (Vitest unit tests, including the static route-link check).
- **Prisma Client:** after any change to `schema.prisma`, run `pnpm db:generate` (and
  `pnpm db:migrate` to persist a migration) before the new types are available.

## Common workflows

| I want to… | Do this |
|------------|---------|
| Change the data model | Edit `prisma/schema.prisma` → `pnpm db:migrate` → `pnpm db:generate`. |
| Add an "enum" value | Add it to the array + `*_META` map in `lib/constants.ts` (no migration needed). |
| Add a UI mutation | Add a Server Action in `lib/actions/<module>.ts`, wire a `<form>` with `useActionState`. |
| Expose it to the API | Add/extend a handler under `app/api/v1/**/route.ts` using `guard()` + shared Zod schema. |
| Reset a messy dev DB | `pnpm db:reset` (re-migrate + reseed). |
| Inspect data | `pnpm db:studio`. |

## Troubleshooting

For identity work, `pnpm brand:check` validates application copies against the
canonical kit; `pnpm brand:sync` regenerates them. A normal `pnpm build` runs
brand validation before Next.js. Full kit generation is a separate authoring
toolchain; see [branding.md](./branding.md) and
[branding/README.md](../branding/README.md).

- **Blank/placeholder in a `Select`** → you're missing `items`; prefer `ComboField` for
  forms (see gotcha above).
- **`asChild` "not a valid prop"** → use `render={…}` (base-ui, not Radix).
- **Stale Prisma types after schema edit** → `pnpm db:generate`.
- **Login redirects loop / 401s** → `AUTH_SECRET` unset; run `npx auth secret` and set it
  in `.env`. Auth is enforced in [`proxy.ts`](../proxy.ts) (the middleware) and in
  Server Actions/Route Handlers.
- **The `AGENTS.md` block keeps reappearing in your diff** → it's re-written by
  `next dev` (`node_modules/next/dist/server/lib/generate-agent-files.js`). Commit it
  with your work rather than deleting it.

---

Contributing guidelines (branching, PRs, commit style): [../CONTRIBUTING.md](../CONTRIBUTING.md).
Deployment to Postgres/production: [deployment.md](./deployment.md).
