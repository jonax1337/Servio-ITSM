# Architecture

This document describes how Servio is put together: the runtime model, how requests
flow through the app, how the code is organised, and how authentication, RBAC, the
integration sync engine, and the database are wired.

Servio is a modern, open-source IT Service Management (ITSM) platform — an
alternative to legacy tools like GLPI. It is a single Next.js 16 application (App
Router, React 19, Turbopack) backed by Prisma 6 and Auth.js v5.

See also: [data-model.md](./data-model.md) · [rest-api.md](./rest-api.md) ·
[design-system.md](./design-system.md) · [modules.md](./modules.md) · [ai.md](./ai.md).

## 🎯 Design principles

| Principle | What it means in this codebase |
| --- | --- |
| One app, three surfaces | A single Next.js app serves the **agent console** (`app/(console)`), the **self-service portal** (`app/portal`), and a **REST API** (`app/api/v1`). |
| Server-first | Pages are React Server Components that query the database directly through Prisma. There is no client-side data-fetching layer. |
| Mutations are Server Actions | The app's own writes go through `"use server"` functions in `lib/actions/*`, invoked from forms. The public API is a separate, token-authenticated surface. |
| Translated UI, English source | Every user-facing string lives in typed per-namespace catalogs (`messages/en`, `messages/de`), read with `getT()` on the server and `useT()` in client components; enum labels are translated at render time. See [i18n.md](./i18n.md). |
| Single source of truth for enums | Status/type/priority values are plain strings validated against `lib/constants.ts` (SQLite has no native enums). See [data-model.md](./data-model.md). |
| One schema, two databases | The same Prisma schema runs on SQLite for local dev and PostgreSQL for production — no code changes, only `provider` + `DATABASE_URL`. |
| Least-privilege access | Roles are enforced in three layers: the edge gate in `proxy.ts`, server-side helpers in `lib/session.ts`, and token scopes in `lib/api.ts`. |

## 🔁 Request & runtime model

Servio has three distinct request paths. Knowing which one you are in tells you
where to put code.

### 1. Reads — Server Components query Prisma directly

Route pages (`page.tsx`, `layout.tsx`) are async Server Components. They call
`db.*` (the Prisma client from [`lib/db.ts`](../lib/db.ts)) inline and render the
result. There is no REST hop for the UI's own reads.

```tsx
// app/(console)/syncs/page.tsx  (abridged)
export const dynamic = "force-dynamic";

export default async function SyncsPage() {
  const sources = await db.syncSource.findMany({ orderBy: [{ name: "asc" }] });
  // ...render...
}
```

List pages read filters/pagination from URL search params using the helpers in
[`lib/query.ts`](../lib/query.ts) (`getParam`, `getPage`, `PAGE_SIZE`,
`buildHref`), so filter state lives in the URL rather than in client state.

### 2. Writes — Server Actions in `lib/actions/*`

The app's own mutations are `"use server"` functions under
[`lib/actions/`](../lib/actions). Forms bind directly to them; each action
validates its `FormData` with Zod, checks permission, mutates through Prisma,
writes an audit entry, and calls `revalidatePath()` to refresh affected routes.

There is one action module per domain:

```
lib/actions/
  account.ts         ai.ts              ai-assistant.ts    ai-insights.ts
  ai-project-files.ts approvals.ts      article-links.ts   assets.ts
  attachments.ts     audit-log.ts       auth.ts            automations.ts
  catalog.ts         catalog-admin.ts   categories.ts      change-assets.ts
  change-copilot.ts  change-freeze.ts   change-templates.ts changes.ts
  contracts.ts       custom-fields.ts   dashboards.ts      email-templates.ts
  groups.ts          knowledge.ts       locations.ts       macros.ts
  maintenance.ts     notifications.ts   oncall.ts          people.ts
  portal.ts          portal-status.ts   problems.ts        releases.ts
  sable-mcp.ts       sable-skills.ts    saved-views.ts     services.ts
  settings.ts        sla-admin.ts       status-incidents.ts survey.ts
  syncs.ts           tickets.ts         tokens.ts          workflows.ts
```

AI mutations are a special case: **Sable never writes directly**. Its write operations live in
`lib/ai-operations/*` as RBAC-gated proposals, and `applyAssistantProposal` (in `ai-assistant.ts`)
re-checks role/scope and re-validates arguments before running the real action. All AI runs
server-side — provider keys never reach the client. Sable's chat turns stream through a Route
Handler (`app/api/assistant/chat`) rather than a Server Action; see below and [ai.md](./ai.md).
(`Sable` is the display name — set by `AI_ASSISTANT_NAME` in `lib/constants.ts` — and the code
identifiers and filenames match it: `sable-*`/`Sable*`.)

A representative action guards on role, validates, mutates, audits, and revalidates:

```ts
// lib/actions/tickets.ts (abridged)
async function requireAgent() {
  const me = await getSessionUser();
  if (!me || !isAgent(me.role as Role)) return null;
  return me;
}

export async function createTicket(_prev: ActionState, formData: FormData) {
  const me = await requireAgent();
  if (!me) return { error: "Not authorised" };
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  // ...create via db, writeAudit(...), revalidatePath(...)...
}
```

Actions return an `ActionState` (`{ error?, fieldErrors? }`) for `useActionState`
form binding, or `redirect()` on success.

### 3. External integrations — Route Handlers under `app/api`

The outside world talks to Servio through Route Handlers, **not** Server Actions.

| Path | Purpose |
| --- | --- |
| `app/api/auth/[...nextauth]/route.ts` | Auth.js sign-in/callback handlers. |
| `app/api/v1/*` | Public, token-authenticated REST API (index `route.ts`, `tickets` incl. `[id]`, `assets`, `services`, `openapi`). |
| `app/api/files/*` | Attachment upload (`upload`), download (`[id]`) and in-browser `preview` / `pdf` renditions; each handler authorises the live DB user (`canUploadTo` / `canViewAttachment`). The multipart intake (stream-capped parse, allow-list validation, blob + row write) lives in `lib/attachment-upload.ts` and is shared with the REST API's `/{entity}/{id}/attachments`. |
| `app/api/search/route.ts` | Global search. |
| `app/api/export/route.ts` | Streaming CSV export (`?type=audit` ADMIN, `?type=tickets` AGENT+). |
| `app/api/dashboard/widget/route.ts` | On-demand widget computation for the dashboard editor preview (AGENT+, DB-truth guard). |
| `app/api/ai/triage/route.ts` | AI triage suggestion for a ticket as a GET handler (session user, rate-limited) so it does not block server actions. |
| `app/api/assistant/chat/route.ts` | Sable's streaming chat turn (POST, agents only). |
| `app/api/portal/assistant/route.ts` | Portal help-center bot stream (USER-scoped, ephemeral). |
| `app/api/portal/search/route.ts` | Portal live search. |
| `app/api/maintenance/route.ts` | Public GET: is maintenance mode on right now (polled by the maintenance page). |

Sable does **not** use a Server Action for chat: the console window and the
`/assistant` route both post the `useChat` message array to
`app/api/assistant/chat` (server-authoritative — it ignores the client history and
rebuilds context from the DB via `lib/assistant-core.ts`), and the reply is
streamed with the AI SDK's `streamText` → UI-message stream (the buffered
`claude-code` CLI provider is emitted as a single uniform stream). Conversation
CRUD, folders, and `applyAssistantProposal` remain Server Actions in
`lib/actions/ai-assistant.ts`. See [ai.md](./ai.md).

Public API routes authenticate with a **Bearer token** (not the session cookie)
via `guard()` from [`lib/api.ts`](../lib/api.ts), which resolves an
`ApiPrincipal` (token id, acting user, scopes, role) and enforces `read`/`write`
scopes. Agent principals act org-wide; non-agent tokens are scoped to the
caller's own objects. Full detail in [rest-api.md](./rest-api.md).

```ts
// app/api/v1/tickets/route.ts (abridged)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await guard(req, "read");
  if ("response" in auth) return auth.response;
  const where = principalIsAgent(auth.principal) ? {} : { requesterId: auth.principal.userId };
  // ...paginate + serialize...
}
```

## 🗂️ Route groups & layout tree

> **Note on drift:** older design docs describe a `src/` directory with
> `(app)/(auth)/(portal)` route groups and a `middleware.ts` file. That structure
> does **not** exist. There is no `src/`; everything is at the repo root. Routes
> are split into `app/(console)` and `app/portal`, auth pages live at `app/login`,
> and the middleware is `proxy.ts` (Next.js 16 naming).

Three layouts define the three surfaces:

- **`app/layout.tsx`** — root layout. Loads local Manrope display type, Inter,
  JetBrains Mono, `ThemeProvider`, and the `Toaster`. Defines application/share
  metadata and browser theme colours. Resolves the request's UI language
  (`getLocale()`: the user's `User.locale`, the `servio-locale` cookie when signed
  out, the instance default `APP_LOCALE`, then English), sets `<html lang>` and
  wraps everything in `<I18nProvider>` — see [i18n.md](./i18n.md). No auth gating. File-based icons and share
  images live in `app/`; static `/brand/*` icons and manifests are public before
  login through the shared route policy. See [branding.md](./branding.md).
- **`app/(console)/layout.tsx`** — the agent console. Calls
  `requireRole("AGENT")`; anything below `AGENT` is redirected to the portal.
  Renders the sidebar (`AppSidebar`) + topbar shell. It also mounts **Sable** once,
  via `<SableProvider>` + `<SableMount>` — a single global assistant window (state
  machine: closed · min · max) opened from a floating action button, with the
  `/assistant` route rendering the same window inline. A `MaintenanceBanner`
  announces upcoming maintenance windows.
- **`app/portal/layout.tsx`** — the self-service portal. Calls `requireUser()`
  (any authenticated user). Renders the help-center header, the portal status and
  maintenance banners and the portal Sable widget; if the user is an agent it shows
  a link back to the console.

Two more top-level routes sit outside both groups and are public in `proxy.ts`:
`app/maintenance` (the page non-admins see during a maintenance window) and
`app/survey/[token]` (the CSAT rating link).

The console is mounted at the **root** path (`/`), so `(console)` is a route
group (parentheses = no URL segment). The portal is a real segment at `/portal`.

```
E:\DEV\servio
├─ app/
│  ├─ layout.tsx              # root: fonts, theme, toaster
│  ├─ globals.css
│  ├─ login/                  # auth pages (public)
│  │  ├─ page.tsx
│  │  └─ login-form.tsx
│  ├─ maintenance/            # maintenance page (public, shown to non-admins)
│  ├─ survey/[token]/         # CSAT rating page (public)
│  ├─ (console)/              # AGENT+ console, mounted at "/"
│  │  ├─ layout.tsx           # requireRole("AGENT")
│  │  ├─ page.tsx             # dashboard
│  │  ├─ tickets/  problems/  changes/  releases/  approvals/
│  │  ├─ oncall/  status/  insights/  assistant/
│  │  ├─ services/  catalog/  assets/  locations/  contracts/  categories/  knowledge/
│  │  ├─ groups/  people/
│  │  ├─ automations/  syncs/  settings/  audit/  no-access/
│  ├─ portal/                 # self-service (any authenticated user)
│  │  ├─ layout.tsx           # requireUser()
│  │  ├─ page.tsx  tickets/  new/  request/  catalog/  knowledge/  status/
│  └─ api/
│     ├─ auth/[...nextauth]/route.ts
│     ├─ v1/                  # public REST API (tickets, assets, services, openapi)
│     ├─ files/               # upload / download / preview / pdf
│     ├─ assistant/chat/  portal/{assistant,search}/  ai/triage/
│     ├─ dashboard/widget/  export/  maintenance/
│     └─ search/route.ts
├─ auth.ts                    # NextAuth (Node runtime): Prisma adapter + providers
├─ auth.config.ts             # edge-safe config: session strategy + JWT callbacks
├─ proxy.ts                   # middleware: edge auth gate
├─ instrumentation.ts         # boot hook: starts the in-process scheduler (Node runtime only)
├─ components/                # UI, one folder per domain + components/ui (base-ui/shadcn)
├─ lib/
│  ├─ actions/                # Server Actions (one file per domain)
│  ├─ ai-operations/          # Sable's RBAC-gated write proposals
│  ├─ connectors/  ticks/     # sync connectors; scheduler feature sweeps
│  ├─ data/                   # shared select options
│  ├─ db.ts        session.ts constants.ts  query.ts  nav.ts  api.ts  route-guard.ts
│  ├─ audit.ts     sla.ts     assignment.ts transitions.ts automations.ts scheduler.ts
│  └─ mail.ts      markdown.ts storage.ts    files.ts …
├─ prisma/
│  ├─ schema.prisma  seed.ts  seed-extras.ts  migrations/  dev.db
├─ sable/                     # Sable's agent home: AGENT.md + built-in skills/
├─ updater/                   # self-update sidecar (standalone Node service, see updates.md)
├─ docker/  Dockerfile  docker-compose*.yml
└─ next.config.ts  package.json  tsconfig.json
```

> **Routing centres on Teams/Groups.** The old "Queues"/"Board" module and the `Queue`
> model were removed; assignment and auto-routing are driven entirely by `Group`.
> Freeform ticket **Tags** were also removed. The dashboard (`app/(console)/page.tsx`)
> is a customizable widget builder — see [modules.md](./modules.md#dashboards).

Console navigation is data-driven from [`lib/nav.ts`](../lib/nav.ts). Each
`NavItem` may carry a `minRole` (`MANAGER`/`ADMIN`); `filterNav()` hides items the
current role cannot use, so the sidebar reflects RBAC.

## 🔐 Auth architecture (Auth.js v5)

Auth.js is deliberately split into two files so the config can run at the edge
(in middleware) without pulling in Prisma or bcrypt.

| File | Runtime | Contents |
| --- | --- | --- |
| [`auth.config.ts`](../auth.config.ts) | Edge-safe | `trustHost`, `pages.signIn = "/login"`, `session.strategy = "jwt"`, and the `jwt`/`session` callbacks. **No providers, no Prisma.** |
| [`auth.ts`](../auth.ts) | Node | Spreads `authConfig`, adds the `PrismaAdapter(db)` and the heavy providers (Credentials + optional OIDC), and exports `handlers`, `auth`, `signIn`, `signOut`. |

`proxy.ts` instantiates NextAuth with only `authConfig` (edge-safe), while
route/server code imports the full instance from `auth.ts`.

**Sessions are JWT-based** (`session.strategy: "jwt"`). The `jwt` callback stamps
`token.uid`, `token.role`, and `token.picture` at login; the `session` callback
copies `id` and `role` onto `session.user`. Because the JWT freezes role/active
state at sign-in, the server-side `requireUser()` helper re-reads the DB user row
per request (see below) so demotions/deactivations take effect immediately — and
every server-action agent guard shares the same DB-truth check via
`requireAgentUser()` (`lib/session.ts`), so actions never trust the frozen JWT role.

**Providers:**

- **Credentials** — email + password. `authorize()` validates with Zod, looks up
  the user, checks `isActive`, compares the bcrypt hash, and stamps `lastLoginAt`.
  Attempts are throttled per-IP and per-account (exponential backoff — see the
  `LOGIN_*` knobs in [configuration.md](./configuration.md)), and every
  successful/failed login writes a `LOGIN`/`LOGIN_FAILED` audit row (with IP).
- **OIDC / SSO** — registered **only** when `AUTH_OIDC_ID` and `AUTH_OIDC_ISSUER`
  are set. Auto-linking an SSO identity to a local account requires the IdP to
  assert a **verified** email (`allowDangerousEmailAccountLinking: false`);
  unverified emails surface `OAuthAccountNotLinked` instead of taking over an
  account by email collision. `ssoEnabled` / `ssoProviderName` are exported so
  the login page can conditionally render the SSO button. The login page is
  `force-dynamic`: prerendered at build time it would bake in the build's
  (empty) `AUTH_OIDC_*` env and never show the button in the Docker image. With
  `AUTH_OIDC_ROLE_MAP` set, the `jwt` callback in `auth.ts` derives the role from
  the IdP's groups/roles claim ([`lib/oidc-roles.ts`](../lib/oidc-roles.ts)),
  persists it on the user row and audits the change. See
  [configuration.md](./configuration.md#role-mapping-from-the-idp).

## 🛡️ RBAC — four roles, three enforcement layers

Roles are a plain string on `User.role`, ordered by rank:

| Role | Rank | Typical access |
| --- | --- | --- |
| `ADMIN` | 3 | Everything, including the audit log, update/maintenance settings (`/settings/updates`) and creating/editing sync sources. |
| `MANAGER` | 2 | Console + manager-only items (catalog, automations, syncs, settings, change freeze windows and templates). |
| `AGENT` | 1 | Console: tickets, problems, changes, CMDB, etc. |
| `USER` | 0 | Self-service portal only. |

Enforcement happens in three complementary places:

**1. Edge gate — [`proxy.ts`](../proxy.ts).** The middleware runs on every request
(except Next internals and shallow static assets, per its `matcher` — deep routes that merely
*end* in an image/media extension still run middleware). It:

- while a blocking maintenance window runs (`SERVIO_STATE_DIR/maintenance.json`, read from the file on every request), sends everyone but admins to the maintenance page (a 503 rewrite with `Retry-After`; JSON 503 for `/api/*`) before any other check. `/login`, `/api/auth`, `/maintenance`, `/api/maintenance` and assets stay reachable. The decision is the pure `maintenanceGate` in `lib/maintenance-rules.ts` (see [updates.md](./updates.md));
- allows `/login`, `/api/auth`, `/api/v1`, `/survey`, `/maintenance`, `/api/maintenance` and the static `/brand` namespace via an **anchored** match
  (`path === p || path.startsWith(p + "/")`, so `/surveypayload` is not covered by `/survey`);
- redirects already-logged-in users away from `/login` to `/`;
- redirects unauthenticated users to `/login?callbackUrl=…`;
- redirects plain `USER`s to `/portal` if they try to reach any non-portal path. Portal paths are `/portal` plus the APIs the portal calls (`/api/portal/*`, `/api/files/*`); those route handlers authorise the live DB user themselves (`isPortalPath` in `lib/route-guard.ts`);
- for console routes, enforces the per-prefix minimum role from `ROUTE_MIN_ROLE` in [`lib/route-guard.ts`](../lib/route-guard.ts) (longest prefix wins; default `AGENT`). Currently `MANAGER` for `/catalog`, `/automations`, `/syncs`, `/changes/freeze`, `/changes/templates`, `/settings` and `/sla`; `AGENT` for `/settings/macros`; `ADMIN` for `/settings/updates` and `/audit`. A role that is too low is redirected to `/no-access?from=…`. These values are kept in sync with `lib/nav.ts` by hand.

This is a coarse first gate. Note it reads the role from the **JWT** (edge), so it
cannot see a just-demoted user — that is what the server layer is for.

**2. Server helpers — [`lib/session.ts`](../lib/session.ts).** The authoritative
layer. Functions are wrapped in React `cache()` so each is one query per request:

| Helper | Behaviour |
| --- | --- |
| `getSessionUser()` | Returns the session user (`id`, `role`, `email`, `name`, `image`) or `null`. Inside a REST API actor scope ([`lib/api-actor.ts`](../lib/api-actor.ts), entered only by `/api/v1` handlers after Bearer auth) it returns the token owner, read from the DB, so the console's server actions run unchanged for the API — see [rest-api.md](./rest-api.md#how-the-itsm-endpoints-enforce-the-consoles-rules). |
| `getCurrentUser()` | Full DB user row (cached). |
| `requireUser()` | Redirects to `/login` if unauthenticated; **re-reads the DB row** and rejects deactivated users; returns the fresh role. |
| `requireRole(min)` | `requireUser()` + rank check; redirects to `/portal` if below `min`. |
| `requireAgentUser()` / `requireManagerUser()` / `requireAdminUser()` | DB-truth guards for Server Actions: re-read the user row and return it, or `null` if inactive or below AGENT / MANAGER / ADMIN. |
| `hasRole(role, min)` / `isAgent(role)` | Pure rank comparisons. |

Layouts and pages call `requireRole("AGENT")` (console) or `requireUser()`
(portal); actions use the `require*User()` guards (some modules keep a local wrapper,
e.g. `requireAdmin()` in `lib/actions/syncs.ts`).

**3. API token scopes — [`lib/api.ts`](../lib/api.ts).** The REST API is orthogonal
to sessions: `guard(req, "read"|"write")` authenticates a Bearer token, checks the
token's scopes, and yields an `ApiPrincipal`. `principalIsAgent()` decides whether
a token sees org-wide data or only the owner's objects. See [rest-api.md](./rest-api.md).

## 🔄 Sync / integrations engine

Servio imports **users and assets** from external systems via a pluggable connector
layer. A source is one `SyncSource` row; a run is one `SyncRun`.

- **`SyncSource`** — `type`, `direction`, `scope`, `schedule` (cron), `config` (JSON as
  TEXT; per-source secrets are AES-GCM encrypted via [`lib/crypto.ts`](../lib/crypto.ts)),
  `isActive`, `lastRunAt`, `lastStatus`. The schema allows `direction`
  `IMPORT`/`EXPORT`/`BIDIRECTIONAL` and `scope` `USERS`/`ASSETS`/`TICKETS`/`ALL`, but the
  implemented connectors only import users and assets.
- **`SyncRun`** — one execution: `status`, `trigger` (`MANUAL`/`SCHEDULE`; `API` is
  allowed by the executor's type but unused), counts (`created`/`updated`/`failed`),
  `log`, `finishedAt`.

The valid `type`, direction, scope, and run-status values are enumerated in
[`lib/constants.ts`](../lib/constants.ts) (`SYNC_TYPES`, `SYNC_DIRECTIONS`,
`SYNC_SCOPES`, `SYNC_RUN_STATUSES`).

**Connector layer** ([`lib/connectors/`](../lib/connectors)). Each connector implements a
`Connector` (`test()` + `run()`) and is resolved by `SyncSource.type` from the registry
(`index.ts`). A pure, client-safe `spec.ts` declares each type's form fields per scope, so
the config UI and the form↔config conversion are generic — adding a connector is ~one file.
Implemented: **LDAP / Active Directory** (`ldapts`, paged, binary `objectGUID`→hex),
**Azure AD / Entra** (Graph client-credentials + paging), **CSV** (URL or inline, RFC 4180),
and **REST** (generic JSON + dot-path mapping + `next` pagination — **NetBox** works this
way: scope Assets, records path `results`, next path `next`). `INTUNE`/`SNOW`/`GLPI` are not
yet implemented and report a `PARTIAL` run rather than failing. Records are upserted by
`(syncSourceId, externalId)` (email/`assetTag` fallback) through the shared `import.ts`
(`importUsers`/`importAssets`); "reconcile removed" deactivates users / retires assets,
never deletes.

**Running.** `executeSyncRun` ([`lib/sync-runner.ts`](../lib/sync-runner.ts)) is
session-less and shared by manual and scheduled runs, guarded by a per-source in-process
lock.

**Scheduler.** [`instrumentation.ts`](../instrumentation.ts) is Next.js's boot hook; on the Node
runtime only it loads `lib/instrumentation-node.ts`, which calls `startScheduler()` and wires
`stopScheduler()` to SIGTERM/SIGINT. The in-process scheduler
([`lib/scheduler.ts`](../lib/scheduler.ts)) is single-instance by design (overlap guards and
markers are in memory): set `SCHEDULER_ENABLED=false` on any replica that must stay passive (see
[deployment.md](./deployment.md)). It runs three built-in loops — the inbound-mail IMAP poll
(`IMAP_POLL_SECONDS`), the cron `syncTick` that fires due sources (`SYNC_TICK_SECONDS`) and the SLA
escalation sweep (`SLA_ESCALATION_TICK_SECONDS`) — plus the feature sweeps in `FEATURE_TICKS` in the
same file: `runInsightsTick`, `runSlaNudgeTick`, `runContractsTick`, `runMaintenanceTick` and
`runUpdateCheckTick` (`lib/ticks/*`). Each sweep has its own interval setting and floor, an overlap
guard, `unref()`ed timers, and errors logged but never thrown. Every tick is session-less, checks
its own enable setting first and uses at-most-once markers in the database (see
[configuration.md](./configuration.md) and [data-model.md](./data-model.md)). Server Actions in
[`lib/actions/syncs.ts`](../lib/actions/syncs.ts):

- `runSync(formData)` — dispatches to the connector, writes the `SyncRun` + source status,
  audits, and returns a real `{ ok, message }`.
- `createSyncSource` / `updateSyncSource` / `deleteSyncSource` / `testSyncConnection` —
  spec-driven config CRUD (secrets encrypted; test uses a saved source).
- `toggleSyncActive(formData)` — pauses/activates a source with an audit trail.

The UI lives at `app/(console)/syncs` (list + `[id]` detail + `new` + `[id]/edit`).
List, detail and **Run now** (`runSync`) require `MANAGER`; create, edit, delete, test and the
active toggle require `ADMIN`.

## 🛠️ Maintenance mode & self-update

Planned maintenance and app updates are coordinated through a small shared **state directory**
(`SERVIO_STATE_DIR`, default `.servio-state`; [`lib/state-dir.ts`](../lib/state-dir.ts)), which is
the file contract between the app, `proxy.ts` and the updater sidecar. Details in
[updates.md](./updates.md).

- **`MaintenanceWindow`** rows (see [data-model.md](./data-model.md)) are scheduled in the console
  (`lib/actions/maintenance.ts`, `/settings/updates`, ADMIN) and advanced by the `maintenance` tick.
- While a window with `blockAccess` is `IN_PROGRESS`, the app writes `maintenance.json` into the state
  directory. `proxy.ts` reads that file on every request (no shared module state) and, via the pure
  `maintenanceGate` in `lib/maintenance-rules.ts`, turns non-admin traffic into the `/maintenance`
  page (503 + `Retry-After`; JSON 503 for `/api/*`). The Prisma-free reader is
  `lib/maintenance-flag.ts`.
- The **`updater/`** directory is a separate Node sidecar. It exchanges `updater/request.json`
  (written by the app), `updater/status.json` and `updater/heartbeat.json` (written by the updater)
  under the state directory, and talks to Docker only through a filtered socket proxy
  (`updater/README.md`). The `update-check` tick compares the running version with the latest
  release (`lib/updates.ts`).

## 🗄️ One schema, two databases

There is a **single** Prisma schema, [`prisma/schema.prisma`](../prisma/schema.prisma).

- **Local dev:** `provider = "sqlite"`, `DATABASE_URL` points at `prisma/dev.db`.
- **Production:** switch the provider to `postgresql` and point `DATABASE_URL` at
  Postgres. See [deployment.md](./deployment.md).

Because SQLite has **no native enums**, all status/type/priority/etc. fields are
plain `String` columns. Their allowed values, human labels, badge tones, and icons
are centralised in [`lib/constants.ts`](../lib/constants.ts) and validated with Zod
at every write boundary (Server Actions and API routes). This keeps the schema
portable across both databases while giving the UI a single, typed source of enum
metadata. Full model reference in [data-model.md](./data-model.md).

The Prisma client is a lazily-created singleton in [`lib/db.ts`](../lib/db.ts),
cached on `globalThis` in non-production to survive Turbopack/HMR reloads. It
carries one query extension: a ticket write into a terminal status also clears
`openExternalRef`, the monitoring dedup key (see [data-model.md](./data-model.md)).
The extended client keeps the plain `PrismaClient` type, since a query extension
changes no signatures.

---

**Next:** [data-model.md](./data-model.md) · [rest-api.md](./rest-api.md) ·
[design-system.md](./design-system.md) · [modules.md](./modules.md)
