# Servio — Remediation Audit 2026-08-23

> THE audit file for Servio. This consolidates the remediation pass of
> 2026-08-23: 4 parallel deep audits (re-verification of the original
> 2026-08-15 system audit, frontend, AI, data model/API), followed by direct
> fixes. The 2026-08-15 snapshot (`AUDIT.md`) was removed after every one of
> its findings was remediated — it lives on in git history. All 19 HIGH
> findings of the original audit were confirmed fixed before this pass; this
> document covers the open tail that remained and what changed.
>
> End state: `tsc --noEmit` 0 errors · ESLint 0 errors/0 warnings ·
> `next build` green · **150 unit tests / 13 suites green** (`pnpm test`) ·
> `pnpm setup` verified end-to-end on a fresh database.

## Security fixes (this pass)

| Fix | Where |
| --- | --- |
| `/api/search` had no role gate — a USER-role portal JWT could enumerate tickets, assets, staff emails org-wide. Now agent-only (403 otherwise) | `app/api/search/route.ts` |
| Zero rate limiting on every AI endpoint (cost/CPU DoS). New `checkAiRate` limiter (20 req/min per user, `AI_RATE_LIMIT`/`AI_RATE_WINDOW_MS` env-tunable, 429 + Retry-After) wired into console chat, portal chat, portal confirm-create and triage | `lib/rate-limit.ts`, `app/api/assistant/chat/route.ts`, `app/api/portal/assistant/route.ts`, `app/api/portal/assistant/create/route.ts`, `app/api/ai/triage/route.ts` |
| Portal assistant routes trusted the stale JWT. Now re-check `isActive` against the DB before any generation | `app/api/portal/assistant/route.ts`, `app/api/portal/assistant/create/route.ts` |
| OIDC `allowDangerousEmailAccountLinking: true` allowed local-account takeover via an unverified IdP email. Now `false` (linking requires a verified email) | `auth.ts` |
| `OLLAMA_BASE_URL` was Sable-writable via `setting.update` — with the ollama provider that URL receives every chat payload. Locked alongside `AI_ALLOW_EXTERNAL`/`AI_PROVIDER` | `lib/ai-operations/modules/config.ts` |
| `asset.update_field` resolved targets by fuzzy `contains` first-match ("SRV-1" could mutate "SRV-12"). Now exact name / unique asset tag with ambiguity refusal | `lib/ai-operations/modules/cmdb.ts` |
| Login events now audited: `LOGIN` + `LOGIN_FAILED` rows (with IP) for the compliance trail the audit viewer already styles | `auth.ts` |
| Server actions trusted the JWT-frozen role: a deactivated/demoted user kept agent powers until token expiry. All 11 local guards now delegate to a shared DB-truth `requireAgentUser()` (role + isActive rehydrated, one cached query per request) | `lib/session.ts`, `lib/actions/*.ts` |

## AI consistency fixes

- **`adminOnly` ops were unreachable**: enforcement still required an ADMIN-scoped
  chat, but the scope toggle was removed from the UI long ago — while the admin
  system prompt advertised the ops. Gating is now role-only (minRole/adminOnly
  vs. the fresh DB role), extracted into a pure, unit-tested helper
  (`lib/ai-operations/availability.ts`). `docs/ai.md` updated to match.
- Deleted ~600 lines of dead, drifted AI code: legacy `sendMessage` action
  (+ its stale prompt copies and duplicate `buildAssistantProposals`),
  `AI_CHAT_TOOLS` + 3 orphaned propose tools, `runPortalAssistant`, `aiStatus`,
  `adminSystemPrompt` (full variant).
- Anthropic default model aligned with the settings-UI guidance
  (`claude-sonnet-5`); `category_list`/`group_list` got branded tool chips.

## SLA / clock correctness

- **Business-hours pause double-count (premature breach)**: `resumeData`
  shifted deadlines by the raw WALL delta but `slaSnapshot`/`slaElapsedPercent`
  also subtracted `pausedMs` — in business mode the budget shrank twice (a
  weekend pause could breach a ticket instantly). Resume now shifts by the
  BUSINESS time consumed during the pause and the snapshot no longer
  double-subtracts. Calendar threading added to every caller
  (`updateTicketField`, resolution, macros, automations, approvals, REST PATCH).
- Escalation sweep skipped `IN_PROGRESS` tickets (the most common working
  state!) — `OPEN_STATUSES` now derives from `OPEN_TICKET_STATUSES`.
- Degenerate calendars (no open time) no longer produce instant-breach
  deadlines; `deadlineFrom` returns null → no SLA clock is stamped.
- `escalateTicket` / Major-Incident now re-price the SLA like every other
  priority change (previously left stale deadlines).
- Regression tests pin all of the above (`tests/unit/sla.test.ts`).

## REST API integrity

- `PATCH /tickets/:id` now enforces the ADMIN-CONFIGURED workflow
  (`canTransitionConfigured` — was the static built-in map only) and re-stamps
  SLA deadlines on priority changes (same contract as the console).
- `POST /tickets` can no longer birth a ticket in a terminal status
  (open statuses only) and validates `requesterId`/`categoryId`/`serviceId`
  FKs up front (422 instead of a 500).
- Seeded demo API token used a 14-char prefix while lookup requires 18 — the
  documented curl examples always 401'd. Fixed in the seed.

## Data model & infrastructure

- **Migrations were unusable**: 23 models had no migration at all, so
  `pnpm setup` / `db:reset` crashed mid-seed. History squashed into a single
  verified baseline (`prisma/migrations/20260823000000_init_baseline`) —
  `migrate diff` confirms zero drift, and `setup` was tested end-to-end on a
  fresh database (migrate deploy → seed → seed-extras).
- Missing hot-path indexes added: `Ticket(updatedAt, serviceId, categoryId,
  slaId, problemId, changeId, mergedIntoId)`, `AuditLog(userId, createdAt)`,
  `AuditLog(action)`, `Group(lastAssignedUserId)`.
- Enum comment drift fixed (`IN_PROGRESS` in `Ticket.status`, `FORWARD` in
  `TicketComment.channel`) — and permanently guarded by
  `tests/unit/schema-sync.test.ts`, which pins every schema comment to
  `lib/constants.ts`.
- `deleteService` now cleans its polymorphic Approval rows (no more dangling,
  still-actionable sign-offs).
- `settingIsSet` no longer reports an undecryptable secret (post key-rotation)
  as configured.
- Location re-parenting guards transitive cycles (same as categories).
- Watchers are no longer sent a content snippet of internal-only notes.

## Frontend fixes

- **Ticket checklist (dead feature revived)**: backend actions + model existed
  but the component was never mounted — `TicketTasks` now renders in the ticket
  sidebar (query extended with `tasks`).
- `/assistant` was unreachable (no nav item, no links) — added to the sidebar.
- **Custom fields are now part of every create form** (ticket, problem,
  change). Previously a required custom field BLOCKED creation entirely
  (enforcement existed, the inputs didn't) — new `FormCustomFields` component
  posts `cf_*` values, problems/changes collect + enforce + persist them like
  tickets.
- Macros opened up to agents for personal macros (page, nav + route-guard all
  agent-reachable; sharing stays MANAGER+), matching the server-action design.
- Settings index: cards now carry `minRole` and hide when the viewer can't open
  them (MANAGERs no longer see seven ADMIN dead-ends); hidden Mail Log page got
  a card.
- Dead code removed: orphaned `/groups|/services|/categories/new` pages,
  `comment-composer`, 8 unused shadcn primitives, dead ternary + unused prop in
  the macro manager. Asset cost no longer hard-codes `$`.
- `useIsMobile` effect no longer calls setState synchronously (react-hooks v6
  error).

## Test suite (new)

`vitest` + 13 suites / **150 tests** (`pnpm test`), covering the DB-free core:
business-hours math, the full SLA clock (incl. business-pause regression),
rate limiting + login backoff, settings-secret crypto (rotation/tamper),
markdown sanitization, CSV quoting, cross-field search, custom-field
validation/enforcement, catalog form + approval-stage validation, transition
maps, nav/route-guard role consistency, AI operation gating, and the
schema↔constants enum-comment sync.

## Verification

| Gate | Result |
| --- | --- |
| `pnpm test` | 150/150 green |
| `pnpm lint` (eslint) | 0 errors, 0 warnings |
| `tsc --noEmit` | clean |
| `next build` | green (all routes) |
| `pnpm setup` on fresh DB | migrate deploy + both seeds green |
| Browser (production build) | login, dashboard, tickets list/detail (Tasks card, Macros), settings/macros, /assistant, settings index all render with live data |

## Known remaining (accepted / low priority)

- In-memory rate limiting and the scheduler remain single-instance by design
  (documented; swap for Redis/cron when scaling horizontally).
- `firstResponseBreached` is wall-clock only (documented NB in `lib/sla.ts`).
