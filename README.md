<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="branding/exports/banners/readme-family-dark.svg">
  <img src="branding/exports/banners/readme-family-light.svg" alt="Servio and Sable — Service, in flow." width="100%">
</picture>

### The open-source ITSM platform with an AI teammate built in.

A modern service desk — tickets, problems, changes, CMDB, a self-service portal and a
clean REST API — with **Sable**, an AI agent that actually works your queue *with your approval*.

[![License: MIT](https://img.shields.io/badge/license-MIT-3559e8?style=flat-square)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![Prisma 6](https://img.shields.io/badge/Prisma-6-2D3748?style=flat-square&logo=prisma&logoColor=white)](https://www.prisma.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-3559e8?style=flat-square)](CONTRIBUTING.md)

</div>

<p align="center">
  <code>Tickets</code> · <code>Problems</code> · <code>Changes</code> · <code>CMDB</code> ·
  <code>Service Catalog</code> · <code>Self-Service Portal</code> · <code>Knowledge Base</code> ·
  <code>Mail Engine</code> · <code>Infra Syncs</code> · <code>SSO</code> · <code>REST API</code> ·
  <code>AI Agent</code>
</p>

---

## Quick start

```bash
pnpm install
cp .env.example .env          # then: npx auth secret  → set AUTH_SECRET
pnpm db:migrate               # create the SQLite schema
pnpm db:seed                  # rich demo data
pnpm dev                      # → http://localhost:3000
```

The only value you **must** set is `AUTH_SECRET`. `DATABASE_URL` already points at a local
SQLite file; SSO, SMTP, storage and AI are all optional.

> **Demo login** — `admin@servio.dev` / `servio123`
> Every seeded account uses `servio123`. Try `mara@servio.dev` (Manager), `sam@servio.dev`
> (Agent), or `liam@servio.dev` (User → lands in the self-service portal).

Full walkthrough → [docs/development.md](docs/development.md)

---

## Meet Sable — your AI service-desk teammate

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="branding/exports/banners/readme-sable-dark.svg">
  <img src="branding/exports/banners/readme-sable-light.svg" alt="Sable by Servio — A capable teammate. On your terms." width="100%">
</picture>

**Sable is Servio's headline feature: an AI teammate that lives inside the service desk and
does real work, not just chat.** One streaming chat window (powered by [assistant-ui](https://www.assistant-ui.com)),
reachable from a floating button anywhere in the console, with folders to organise conversations.

|  | What it does |
|---|---|
| 🧠 **Knows your data** | Lists *your* tickets and the team backlog, opens any ticket in full (SLA, breaches, comments), free-text searches tickets/problems/changes/KB — and can search the web when the answer isn't in-house. |
| ✅ **Acts, but only on approval** | Proposes changes as **approval cards** (*"Resolve INC-0042 as Fixed"*). You click **Approve** — only then does the mutation run, re-validated server-side. Nothing is written until you say so. |
| 🛡️ **Bounded by your RBAC** | Tickets, categories, groups, users, services, catalog, CMDB, KB, problems & changes — and, for admins, SLAs and settings. Sable can do exactly what *you* could in the UI, never more. |
| 🔒 **Self-hostable & private** | Runs fully local on **Ollama** (nothing leaves the box) or via your own **Anthropic / OpenAI** key. A hard privacy gate blocks external providers unless you opt in. |

**End users get Sable too.** The self-service portal has its own **Ask Sable** — a deliberately
smaller, USER-scoped assistant on the same UI. It answers from the *public* KB and catalog, reads
that user's *own* tickets, understands attached screenshots of an error, and opens a
correctly-routed ticket or catalog request — all confirm-first. It shares **none** of the agent tools.

Deep dive → [docs/ai.md](docs/ai.md)

Brand assets → [Servio + Sable brand kit](branding/README.md) · [Brand guidelines](branding/brand-guide.pdf)

---

## How Servio compares

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/benchmark/clicks-dark.svg">
  <img src="docs/benchmark/clicks-light.svg" alt="Total clicks for 17 service-desk tasks: Servio 73, GLPI 120, Znuny 132, iTop 146" width="100%">
</picture>

We scripted 17 everyday tasks, from an end user reporting an incident to an admin adding a
category, and ran them in Servio, GLPI, iTop and Znuny with the same seed data. Servio needs
**73 clicks** for all of them (GLPI 120, Znuny 132, iTop 146) and is the only one of the four
that completes every task without a workaround.

Per-task numbers, versions, method and the limits of the comparison → [docs/benchmark.md](docs/benchmark.md)

---

## Features

- **Service desk** — incidents & requests with priority, impact/urgency, **business-hours SLA targets
  with tiered escalation** (working-hours calendars, holidays, and staged notify/reassign/bump policies),
  admin-configurable **workflow governance** (status-transition rules), inline-editable properties (type
  is switchable, its reference number stays stable), cross-entity linking to problems/changes/assets, and
  a threaded activity log with internal notes.
- **Agent macros** — reusable canned responses / one-click bundles of ticket actions, personal or
  team-shared, applied from the ticket detail (transitions & RBAC re-validated on apply).
- **Cross-field search & CSV export** — free-text ticket search spanning title, description, comments,
  requester, and custom fields; export the ticket list (or, for admins, the audit log) to CSV.
- **CSAT surveys** — a public, one-time satisfaction rating minted on resolution and linked from the
  resolution email, with an average-score dashboard widget.
- **Admin audit log** — an ADMIN-only viewer over every recorded action, with user/entity/action/date
  filters and CSV export.
- **Automations** — condition→action rules on ticket create/update and on SLA at-risk/breach
  (assign, set fields, escalate, notify, webhook, declare a major incident…).
- **Customizable dashboards** — a drag-and-drop, resizable widget grid: stats, bar/donut
  breakdowns, SLA gauges, trends and aging. Per-widget filters, accent colour and value
  **thresholds** (`< 15 → red`), each drilling into the matching ticket list. Personal + shared boards.
- **Saved views** — save any set of ticket filters as a named, searchable view (personal or team).
- **Problem & change management** — root-cause / known-error tracking; normal/standard/emergency
  changes with a **Change Advisory Board (CAB)** approval flow (**unanimous, quorum, or percentage**
  approval rules), implementation & rollback plans, and affected CIs with automated impact/risk.
- **CMDB / Assets** — typed configuration items with a **dependency graph**, **blast-radius impact
  analysis**, **locations**, and linked tickets.
- **Service catalog** — requestable services with live status (operational / degraded / outage) and SLAs,
  plus **multi-stage / group approval** workflows and re-request after rejection.
- **Knowledge base** — published how-to / troubleshooting articles with internal vs. public visibility,
  surfaced in the console, the portal, and Sable's search.
- **Mail engine** — a real two-way email bridge: outbound SMTP notifications and **inbound IMAP**
  polling that turns replies into ticket comments, with RFC-2822 threading (message-id / references),
  HTML + CC. No SMTP configured? It runs in outbox mode.
- **Infrastructure Syncs** — pluggable connectors importing **users & assets** on a cron schedule
  or on demand, with run history: Active Directory / LDAP, Azure AD / Entra, CSV, and generic REST (e.g. NetBox).
- **Self-Service Portal** — a redesigned help center: one **live search** across KB, catalog and
  your tickets; report issues or request services with **screenshot/file attachments**; track and
  reply to tickets; and **Ask Sable**.
- **SSO** — OIDC (Keycloak, Authentik, Azure AD, Okta, Google…) plus email/password.
- **RBAC** — Admin / Manager / Agent / User, enforced in `proxy.ts` and every server action.
- **Public REST API** — versioned `/api/v1`, Bearer-token auth with scopes, pagination, filtering, and an OpenAPI 3.1 doc.
- **Relay + Nova Flow branding** — Navy/Cobalt themes, local Manrope display type,
  Servio/Sable vector marks, icons and share previews from the [brand kit](branding/README.md).
- **Beautiful by default** — a quiet service-desk layout, command palette (⌘K),
  responsive layout, and designed empty/loading states.

---

## Tech stack

| Layer | Choice |
|-------|--------|
| **Framework** | Next.js 16 · App Router · React 19 · Turbopack |
| **UI** | base-ui + Tailwind v4 · lucide icons · Recharts · assistant-ui (chat) |
| **Data** | Prisma 6 — SQLite (dev) / PostgreSQL (prod) |
| **Auth** | Auth.js v5 — Credentials + OIDC, JWT sessions |
| **AI** | Vercel AI SDK 7 — Anthropic / OpenAI-compatible / Ollama / Claude CLI |
| **Validation** | Zod 4 — shared by server actions *and* the REST API |

---

## Enabling Sable

Off by default. The privacy-safe way to switch it on is **local Ollama** — no key, nothing leaves the box:

```dotenv
AI_PROVIDER="ollama"
OLLAMA_BASE_URL="http://localhost:11434/v1"
OLLAMA_MODEL="llama3.1"
```

Prefer a hosted model? Pick the provider, flip the privacy gate, add a key:

```dotenv
AI_PROVIDER="anthropic"       # or "openai"
AI_ALLOW_EXTERNAL="true"      # required for ANY external provider
ANTHROPIC_API_KEY="sk-ant-…"  # or OPENAI_API_KEY (+ optional OPENAI_BASE_URL)
```

| Provider | Runs | Key | Notes |
|----------|------|-----|-------|
| **Ollama** | Local, on-box | — | Fully offline. The privacy-safe default. |
| **Anthropic** | External API | `ANTHROPIC_API_KEY` | Default `claude-sonnet-5`. Needs the external gate. |
| **OpenAI-compatible** | External API | `OPENAI_API_KEY` | OpenAI, OpenRouter, Moonshot/Kimi, Zhipu/GLM… |
| **Claude subscription** | Local `claude` CLI | — | Drives your logged-in Claude Pro/Max. |

Every provider runs through the locally installed **Claude Code** CLI (`claude` must be on the
server), so all models share one agent loop and the chat shows thinking and tool calls live;
OpenAI-compatible and Ollama models are translated by a built-in localhost proxy.

Point Sable at a **vision-capable** model to read attached screenshots. Everything is also
manageable from **Settings › Sable (AI assistant)** (ADMIN), which overrides `.env` and encrypts
keys at rest. Full reference → [docs/ai.md](docs/ai.md)

---

## REST API

Authenticate with a Bearer token (create one under **Settings › API Tokens**):

```bash
curl "http://localhost:3000/api/v1/tickets?status=open" \
  -H "Authorization: Bearer <token>"
```

```
GET/POST   /api/v1/tickets          GET/PATCH  /api/v1/tickets/{id}
GET/POST   /api/v1/assets           GET/PATCH  /api/v1/assets/{id}
GET        /api/v1/services         GET        /api/v1/openapi   (OpenAPI 3.1)
```

Seeded dev token (`read,write`, owned by `admin@servio.dev`): `servio_demo_pat_0123456789abcdef`.
Full reference → [docs/rest-api.md](docs/rest-api.md)

---

## Architecture

```
app/
  (console)/   Agent console — dashboard, Sable, every module (route group, mounted at /)
  portal/      Self-service portal for end users
  login/       Auth pages
  api/v1/      Public REST API (token auth)
components/     Shared UI + base-ui primitives (components/ui)
lib/            db, session, constants (enums), actions, ai-operations (RBAC-gated writes)
prisma/         schema.prisma + seed
proxy.ts        Middleware / edge auth gate (Next 16 naming)
```

- **Server Actions** (`lib/actions/*`) power the app's mutations; **Route Handlers** (`app/api/*`) serve the outside world.
- **All AI runs server-side** — provider keys never reach the client; every Sable write goes
  through the same RBAC-checked path as the UI (`lib/ai-operations/*`).
- **Enum fields are `String` columns** backed by typed constants in `lib/constants.ts` — flip the
  datasource to PostgreSQL with no schema changes.

Deep dive → [docs/architecture.md](docs/architecture.md)

---

## Documentation

| Doc | Contents |
|-----|----------|
| [development.md](docs/development.md) | Local setup, demo credentials, conventions |
| [configuration.md](docs/configuration.md) | Environment variables, SSO, SMTP, AI, storage |
| [ai.md](docs/ai.md) | **Sable** — providers, privacy gate, tools & the approve-first flow |
| [architecture.md](docs/architecture.md) | Runtime model, RBAC, sync engine |
| [data-model.md](docs/data-model.md) | Prisma schema & enum strategy |
| [rest-api.md](docs/rest-api.md) | The `/api/v1` REST API |
| [design-system.md](docs/design-system.md) | Theme, tokens, and UI primitives |
| [branding.md](docs/branding.md) | Brand kit, shared logos, fonts and generated application assets |
| [modules.md](docs/modules.md) | Feature-to-file map |
| [deployment.md](docs/deployment.md) | PostgreSQL, production, persistence |

---

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Dev server (Turbopack) |
| `pnpm build` / `pnpm start` | Production build & serve |
| `pnpm lint` | Lint (`eslint` / `eslint-config-next`) |
| `pnpm brand:check` / `pnpm brand:sync` | Validate / synchronize application assets from the canonical brand kit |
| `pnpm db:migrate` | Prisma migrations (`prisma migrate dev`) |
| `pnpm db:seed` | Seed demo data |
| `pnpm db:reset` | Reset DB + reseed |
| `pnpm db:studio` | Open Prisma Studio |
| `pnpm setup` | `prisma migrate deploy && prisma db seed` (CI / first deploy) |

---

## Going to production

Swap the datasource in `prisma/schema.prisma` to `postgresql`, point `DATABASE_URL` at your
Postgres instance, set a strong `AUTH_SECRET`, then `pnpm setup` and `pnpm build && pnpm start`.
See [docs/deployment.md](docs/deployment.md).

---

<div align="center">

**Contributions welcome** — start with [CONTRIBUTING.md](CONTRIBUTING.md).

Built with Next.js, Prisma & Sable · MIT licensed — see [LICENSE](LICENSE)

</div>
