# Module & feature map

This is the internal working reference for anyone (human or Claude Code) extending Servio. It maps every feature to its real files so you can jump straight to the right place. Every path below was verified against the code.

Servio has two surfaces:

| Surface | Route root | Audience | Layout |
| --- | --- | --- | --- |
| **Agent console** | `app/(console)/*` | Agents, managers, admins | `app/(console)/layout.tsx` (sidebar + topbar) |
| **Self-service portal** | `app/portal/*` | End users (requesters) | `app/portal/layout.tsx` (portal nav) |

Auth pages live at `app/login` (not a route group). There is **no `src/` directory** — everything is at the repo root. The request middleware is `proxy.ts` (Next 16 naming), not `middleware.ts`. See [architecture.md](./architecture.md) for the request lifecycle and auth/role gating.

## Per-module anatomy

Console modules follow one consistent shape. When adding a feature, mirror this layout so agents and contributors can predict where things live:

| Concern | Location | Notes |
| --- | --- | --- |
| List page | `app/(console)/<mod>/page.tsx` | Server Component; queries `lib/db`, renders table/cards. `export const dynamic = "force-dynamic"`. Filters + pagination are URL-driven; tables sort via `<SortableHead>` (`?sort=&dir=`, mapped to a Prisma `orderBy`). |
| Detail page | `app/(console)/<mod>/[id]/page.tsx` | Loads one record + related data; renders a `*-properties` panel and action components. |
| Create page | `app/(console)/<mod>/new/page.tsx` | Renders the `*-form` component. Some modules create via a dialog instead (e.g. Locations, Categories). |
| Server actions | `lib/actions/<mod>.ts` | All mutations. `"use server"`, Zod-validated, role-checked via `lib/session`, then `revalidatePath`. |
| UI components | `components/<mod>/` | Client components: forms, dialogs, property panels, action buttons. |
| Select options | `lib/data/options.ts` | Single cached `getFormOptions()` supplies dropdown data (users, groups, categories, services, etc.) to every form. |

Enums, status/priority metadata, and reference helpers (`ticketRef`, `problemRef`, `changeRef`, `PRIORITY_META`, `TICKET_STATUS_META`, `OPEN_TICKET_STATUSES`) live in `lib/constants.ts` — **not** `lib/enums.ts`. Navigation grouping and per-item role gating live in `lib/nav.ts` (`consoleNav`, `filterNav`). See [data-model.md](./data-model.md) for the underlying Prisma models. To contribute a new module, follow the pattern below and read [../CONTRIBUTING.md](../CONTRIBUTING.md).

## Navigation groups

`lib/nav.ts` groups console modules and gates each by `minRole` (`AGENT` < `MANAGER` < `ADMIN`; `filterNav` hides items above the user's rank):

| Group | Modules |
| --- | --- |
| Overview | Dashboard (`/`), Sable (`/assistant`) |
| Service Desk | Tickets, Problems, Changes, Approvals, Knowledge Base |
| Catalog | Services, Service Catalog (MANAGER+) |
| CMDB | Assets, Locations |
| Organisation | Groups, People, Categories |
| Administration | Automations (MANAGER+), Macros (AGENT+; sharing is MANAGER+), Syncs (MANAGER+), Audit Log (ADMIN), Settings (MANAGER+) |

---

## Overview

### Sable (AI assistant)
Servio's built-in AI service-desk agent — a chat surface that can read the queue,
search the app and the web, and **propose changes the user approves before anything is written**.
The display name is **Sable** (`AI_ASSISTANT_NAME` in `lib/constants.ts`); code identifiers and
filenames match it (`sable-*`/`Sable*`). Full write-up: [ai.md](./ai.md).

| | |
| --- | --- |
| Routes | `app/(console)/assistant/page.tsx` (route `/assistant`, AGENT+) — renders the ONE global window inline (deep-linkable) |
| Streaming route | `app/api/assistant/chat/route.ts` (POST, AGENT+) — server-authoritative: rebuilds history from the DB and streams (AI SDK v7 `streamText` → `toUIMessageStreamResponse`; the claude-code provider is buffered and synthesises tool parts) |
| Shared core | `lib/assistant-core.ts` (`getActingAgent`, `prepareAssistantTurn`, `buildUserContent`, `generalSystemPrompt`/`adminSystemPromptSection`, `buildAssistantProposals`, `sanitizeUploads`) — pre-model logic shared by the route |
| Actions | `lib/actions/ai-assistant.ts` — conversation CRUD (`listConversations`, `createConversation`, `getConversation`, `renameConversation`, `archiveConversation`) + folder actions (`listFolders`, `createFolder`, `renameFolder`, `deleteFolder`, `moveConversation`) + `applyAssistantProposal` (the old console `sendMessage` is retired) |
| Global window | `components/assistant/` — `sable-provider` (state machine `closed`\|`min`\|`max`, mounted once in `app/(console)/layout.tsx`), `sable-mount`, `sable-window`, `sable-fab` (floating action button restoring the last state), `sable-chrome` (shared FAB/header chrome + Sable wordmark) |
| Chat UI | `sable-thread` (wires `useChatRuntime(AssistantChatTransport)` to the streaming route, hydrates history, creates a conversation lazily on first send), `sable-tool-ui` (read-tool activity via `ToolFallback`; approve-first `proposal-card` for `propose_*` tools, persisted in localStorage), the left rail `sable-rail` (New chat, search, folders with @dnd-kit drag, archived) |
| assistant-ui scaffold | `components/thread.tsx` (+ `markdown-text`, `reasoning`, `tool-fallback`, `tool-group`, `tooltip-icon-button`, `attachment`, `follow-up-suggestions`) — packages `@assistant-ui/react` + `@assistant-ui/react-ai-sdk` |
| Provider layer | `lib/ai.ts` (config + privacy gate; `currentProvider`/`resolveChatModel`/`chatMaxOutputTokens`), `lib/claude-cli.ts` (Claude Agent SDK adapter) |
| Read tools | `lib/assistant-tools.ts`, `lib/ai-tools.ts`, `lib/ai-admin-tools.ts`, `lib/ai-stats.ts` |
| Write operations | `lib/ai-operations/` (`registry.ts`, `types.ts`, `tools.ts`, `modules/*` — tickets, taxonomy, org, catalog-services, cmdb, knowledge, problems-changes, config) |
| Settings | `app/(console)/settings/ai/page.tsx` (ADMIN) |
| Data | `AiConversation` (with `folderId`), `AiFolder`, `AiMessage` (`prisma/schema.prisma`) |

There is ONE global window, mounted once in the console layout via `<SableProvider>` + `<SableMount>`;
the floating action button (`SableFab`, bottom-right) restores its last state, and `/assistant`
renders the same window inline. Every write is an RBAC-gated `AiOperation` surfaced as a `propose_*`
tool; `applyAssistantProposal` re-checks role/scope and re-validates args before running the real
mutation.

---

## Service Operations

### Tickets
The core incident/request module and the richest one in the codebase.

| | |
| --- | --- |
| Routes | `app/(console)/tickets/page.tsx`, `[id]/page.tsx`, `new/page.tsx` |
| Actions | `lib/actions/tickets.ts` |
| Components | `components/tickets/` |

Actions include `createTicket`, `updateTicketField` (incl. switching `type` — the ref prefix stays fixed), `updateTicketDetails`, `addTicketComment`, `escalateTicket`, `toggleMajorIncident`, `toggleWatch`, `addParticipant`, `linkTicket`/`unlinkTicket`, `mergeTicket`, cross-entity linking (`setTicketProblem`, `setTicketChange`, `linkAsset`/`unlinkAsset`, `unlinkRelation`), `setTicketResolution`, `setTicketPending`, `setTicketDueDate`, `forwardTicketExternal`, and work-log entries (`addWorkLog`, `deleteWorkLog`). Key components: `ticket-form`, `ticket-properties` (staged edits incl. type + due date), `ticket-actions`, `work-log`, `resolution-dialog`, `pending-reason-dialog`, `due-date-picker`, `sla-badge`, `form-answers`, `macro-picker` (apply a canned macro in one click), plus the reusable `link-picker` (attach problems/changes/assets), `saved-views-bar`, and `ticket-tasks` (sidebar checklist — actions `addTask`/`toggleTask`/`deleteTask`). Create forms (`ticket-form`, `problem-form`, `change-form`) include admin-defined custom fields (`components/custom-fields/form-custom-fields`).

**Cross-field search & CSV export:** the tickets list uses `lib/search.ts` (`ticketSearchWhere`/`applyTicketSearch`) for a free-text `q` that spans title, description, comment bodies, requester name/email, and custom-field values (plus a bare-number match on the ticket id) — SQLite-portable, ANDed onto the existing filters. The same helper backs the global `/api/search` route. An **Export CSV** button on the list (and dashboard) hits `GET /api/export?type=tickets` (AGENT+), built on the shared `lib/csv.ts` (`toCsv`/`csvResponse`).

**Saved views:** `/tickets` carries a searchable list of saved filter sets (`SavedView`) — apply/save/delete named filters, personal or (MANAGER+) shared with a team. Actions in `lib/actions/saved-views.ts`.

**Bulk actions & sorting:** the tickets table (`components/tickets/tickets-table.tsx`) has row checkboxes + a bulk bar to set assignee/team/priority/status on many tickets at once (`bulkUpdateTickets` re-runs `updateTicketField` per ticket, so transitions/SLA/automations stay correct). All list tables (tickets, problems, changes, assets, people, groups) have sortable columns via `components/sort-header.tsx`.

### Problems

| | |
| --- | --- |
| Routes | `app/(console)/problems/page.tsx`, `[id]/page.tsx`, `new/page.tsx` |
| Actions | `lib/actions/problems.ts` — `createProblem`, `updateProblemField`, `updateProblemDetails`, `addProblemComment` |
| Components | `components/problems/` — `problem-form`, `problem-properties`, `create-problem-dialog` |

### Changes
Includes a built-in approval workflow.

| | |
| --- | --- |
| Routes | `app/(console)/changes/page.tsx`, `[id]/page.tsx`, `new/page.tsx` |
| Actions | `lib/actions/changes.ts` — `createChange`, `updateChangeField`, `updateChangeDetails`, `addChangeComment`, `submitChangeForApproval`, `addChangeApprover`, `removeChangeApprover`, `decideApproval`, `setCabRule` (CAB quorum/percent rule); `lib/actions/change-assets.ts` — `attachAffectedCi`/`detachAffectedCi` |
| Components | `components/changes/` — `change-form`, `change-properties`, `approval-panel`, `approval-actions`, `add-approver`, `remove-approver`, `submit-for-approval`; affected-CI panel with automated impact/risk |

**CAB quorum & affected CIs:** a change carries an `approvalRule` (`UNANIMOUS` / `QUORUM` / `PERCENT`) + `approvalThreshold`; `lib/cab.ts` (`evaluateCab`) tallies seated approvals against the rule and reports whether the board is satisfied, and `setCabRule` (MANAGER+) can lower the bar mid-flight. The affected-CI panel attaches `ChangeAsset` rows and surfaces blast-radius impact from `lib/cmdb-graph.ts` (`computeImpact`).

### Approvals
A cross-cutting inbox for the current user's pending approvals (currently backed by change approvals).

| | |
| --- | --- |
| Route | `app/(console)/approvals/page.tsx` (list only — no detail/new) |
| Actions | `lib/actions/approvals.ts` — `decideApproval` (advances multi-stage catalog approvals), `seatCatalogStage`/`seatCatalogApprovalStages` (seat the ordered stages), plus the generic ad-hoc `requestApproval`/`decideEntityApproval`/`cancelApproval` |
| Components | `components/approvals/approval-decision` |

**Multi-stage / group catalog approvals:** a `CatalogItem` can define ordered `approvalStages` (each an approver *or* a group) via `lib/actions/catalog-admin.ts` → `updateApprovalStages` (editor UI in the catalog admin page). New requests seat stage 0; approving a stage advances to the next (`seatCatalogStage`), and a rejected/cancelled request can be re-raised with the saved answers via `lib/actions/catalog.ts` → `reRequestCatalogItem`. The portal shows a stage-progress timeline.

---

## Catalog & CMDB

### Services
The service portfolio (business/technical services tickets are filed against).

| | |
| --- | --- |
| Routes | `app/(console)/services/page.tsx`, `[id]/page.tsx`, `new/page.tsx` |
| Actions | `lib/actions/services.ts` — `createService`, `updateServiceField` |
| Components | `components/services/` — `service-form`, `service-properties`, `create-service-dialog` |

### Service Catalog (admin)
The requestable-item catalog editor (MANAGER+; `requireRole("MANAGER")`). List-style admin page — no `[id]`/`new` routes; items are edited inline.

| | |
| --- | --- |
| Route | `app/(console)/catalog/page.tsx` |
| Actions | `lib/actions/catalog-admin.ts` — `createCatalogItem`, `updateCatalogItem`, `toggleCatalogPublished`, `deleteCatalogItem`, `updateApprovalStages` (ordered multi-stage / group approvals) |
| Components | `components/catalog/` — `catalog-editor`, `catalog-browser`, `catalog-icon`, `publish-toggle` |

Catalog request forms are defined via `lib/service-forms.ts` (`parseFormSchema`). The requester-facing catalog lives in the portal (below); `lib/actions/catalog.ts` (`createCatalogRequest`) is the request-submission action shared with the portal.

### Assets (CMDB)

| | |
| --- | --- |
| Routes | `app/(console)/assets/page.tsx`, `[id]/page.tsx`, `new/page.tsx` |
| Actions | `lib/actions/assets.ts` — `createAsset`, `updateAssetField`, `updateAsset` |
| Components | `components/assets/` — `asset-form`, `asset-properties`, `asset-edit-dialog`, `impact-graph` (blast-radius panel) |

**Impact analysis:** `lib/cmdb-graph.ts` (`computeImpact`) walks `AssetRelation` edges from a root CI (up/downstream, depth-bounded) to compute a blast radius; the asset detail page renders it via `impact-graph`, and Changes reuse it for affected-CI impact/risk.

### Locations
Created/edited via dialog (no `new/` route).

| | |
| --- | --- |
| Routes | `app/(console)/locations/page.tsx`, `[id]/page.tsx` |
| Actions | `lib/actions/locations.ts` — `createLocation`, `updateLocation`, `deleteLocation` |
| Components | `components/locations/location-dialog` |

### Categories
Ticket/problem/change categorisation tree.

| | |
| --- | --- |
| Routes | `app/(console)/categories/page.tsx`, `new/page.tsx` |
| Actions | `lib/actions/categories.ts` — `createCategory`, `updateCategory` |
| Components | `components/categories/` — `category-form`, `create-category-dialog` |

### Knowledge base
The only console module keyed by `slug` instead of `[id]`, with a dedicated edit route.

| | |
| --- | --- |
| Routes | `app/(console)/knowledge/page.tsx`, `[slug]/page.tsx`, `[slug]/edit/page.tsx`, `new/page.tsx` |
| Actions | `lib/actions/knowledge.ts` — `createArticle`, `updateArticle`, `changeArticleStatus`, `deleteArticle`, `restoreArticleRevision` |
| Components | `components/knowledge/article-editor` (uses the shared `components/ui/rich-text-editor`), `components/knowledge/article-history-dialog` (browse `ArticleRevision` history, non-destructive restore — restoring writes a new revision instead of deleting/rewriting) |

---

## Organisation

### Groups / Teams
Groups are the unit of assignment/auto-routing (they replaced Queues). Includes auto-assign configuration.

| | |
| --- | --- |
| Routes | `app/(console)/groups/page.tsx`, `[id]/page.tsx`, `new/page.tsx` |
| Actions | `lib/actions/groups.ts` — `createGroup`, `setGroupAutoAssign` |
| Components | `components/groups/` — `group-form`, `create-group-dialog`, `auto-assign-control` |

### People
User directory. Read-heavy; users are typically provisioned via syncs, so there is no `new/` route.

| | |
| --- | --- |
| Routes | `app/(console)/people/page.tsx`, `[id]/page.tsx` |
| Actions | `lib/actions/people.ts` — `updateUserField` |
| Components | `components/people/user-properties` |

### Dashboards

Customizable widget dashboards on the home page (`/`). Every user gets a personal **"My Dashboard"**; managers/admins can create dashboards shared with a team or everyone. A searchable dropdown switches dashboards; **Edit** mode is a drag/resize grid ([react-grid-layout](https://github.com/react-grid-layout/react-grid-layout)) with per-widget config and a live preview.

| | |
| --- | --- |
| Routes | `app/(console)/page.tsx` (view + `?edit=1` editor); `app/api/dashboard/widget` (live-preview compute) |
| Actions | `lib/actions/dashboards.ts` — `ensurePersonalDashboard`, `createDashboard`, `setDashboardLayout`, `updateDashboardSettings`, `renameDashboard`, `deleteDashboard` |
| Engine / types | `lib/dashboard/compute.ts` (server metric engine), `lib/dashboard/types.ts` (`Widget`, `DEFAULT_LAYOUT`) |
| Components | `dashboard-picker`, `dashboard-grid-view`, `dashboard-canvas` (editor), `widget-card`, `widget-config-dialog`; charts in `components/charts` |

Widget types: **stat**, **breakdown** (bar or donut; group by priority/status/type/assignee/team/category/service/source/impact/urgency), **volume** trend, **SLA & MTTR** gauge, **aging**, **CSAT** (average survey rating + response count), and **ticket list**. Each widget carries its own filters and an optional accent colour; stat widgets support value **thresholds** (e.g. `< 15 → red`) that tint the whole card. Stat/SLA cards and every breakdown segment drill into the matching `/tickets` filter URL.

---

## Administration

### Automations
Rule engine (trigger → conditions → actions), MANAGER+.

| | |
| --- | --- |
| Route | `app/(console)/automations/page.tsx` |
| Actions | `lib/actions/automations.ts` — `createRule`, `updateRule`, `toggleRule`, `deleteRule` |
| Engine | `lib/automations.ts` — `runAutomations(trigger, ticketId)` (direct DB writes, never user actions, so it can't recurse) |
| Components | `components/automations/` — `rule-builder`, `toggle-switch` |

Internal-note actions are authored by a pseudo **"Automation"** system account (inactive, no login) via `getAutomationUserId()` in `lib/system-user.ts`, so automated comments are clearly attributed to the system rather than an admin.

### Syncs / Integrations
Pluggable connectors that import **users and assets** (LDAP/AD, Azure AD/Entra, CSV, REST — e.g. NetBox), on a cron schedule or on demand. View/run MANAGER+, configure ADMIN.

| | |
| --- | --- |
| Routes | `app/(console)/syncs/` — `page.tsx`, `[id]/page.tsx`, `new/page.tsx`, `[id]/edit/page.tsx` |
| Connectors | `lib/connectors/` — `types.ts`, `index.ts` (registry), `spec.ts` (form fields, pure), `import.ts` (shared upsert), `ldap.ts`, `azure.ts`, `csv.ts`, `rest.ts` |
| Actions | `lib/actions/syncs.ts` — `runSync`, `create`/`update`/`delete` `SyncSource`, `testSyncConnection`, `toggleSyncActive` |
| Runner / scheduler | `lib/sync-runner.ts` (`executeSyncRun`), `lib/scheduler.ts` (`syncTick`/`isSyncDue`, from `instrumentation.ts`) |
| Components | `components/syncs/` — `source-form`, `run-button`, `toggle-active` |

The whole scheduler (`lib/scheduler.ts`: SLA escalation sweep, inbound-mail poll, scheduled syncs) can be disabled per process with the `SCHEDULER_ENABLED` env flag (default `true`) — see [configuration.md](./configuration.md).

### Settings
A hub page (`app/(console)/settings/page.tsx`, MANAGER+) linking to sub-pages — cards carry a `minRole` and hide when the viewer can't open the target, so managers never see admin dead-ends:

| Sub-page | Route | Purpose | Actions / components |
| --- | --- | --- | --- |
| API tokens | `settings/api/page.tsx` | Create/revoke API tokens | `lib/actions/tokens.ts` (`createApiToken`, `revokeApiToken`); `components/settings/token-manager` |
| Mail | `settings/mail/page.tsx` | SMTP status + mail queue (`lib/mail.ts`, `smtpConfigured`) | Read-only view of the mail log |
| SLA | `settings/sla/page.tsx` | Tabbed: **SLAs**, **Calendars** (business hours), **Escalation** (staged policies) | `lib/actions/sla-admin.ts` (SLA CRUD `createSla`/`updateSla`/`toggleSla`/`deleteSla`; calendar CRUD `createCalendar`/`updateCalendar`/`deleteCalendar`/`addHoliday`/`deleteHoliday`; policy CRUD `createPolicy`/`updatePolicy`/`deletePolicy`/`addStep`/`deleteStep`); `components/settings/sla-manager`, `calendar-manager`, `escalation-manager`; tabs in `settings/sla/tabs.tsx` |
| Macros | `settings/macros/page.tsx` (AGENT+ for personal macros; sharing is MANAGER+) | Manage canned-response macros (ordered ticket actions) | `lib/actions/macros.ts` (`createMacro`, `updateMacro`, `deleteMacro`, `applyMacro`); `components/settings/macro-manager` |

**Business-hours SLA & escalation:** when an `SLA` references a `BusinessCalendar`, deadlines are computed in working time (`lib/business-hours.ts` `elapsedBusinessMs`/`addBusinessMs`, wired through `lib/sla.ts`; wall-clock when no calendar is set). `lib/sla-escalation.ts` (`runSlaEscalation`, swept by the scheduler) fires each `EscalationStep` (`NOTIFY`/`REASSIGN`/`BUMP_PRIORITY`) at its `thresholdPercent`, durably at-most-once, and handles first-response breach.

### Audit Log
Read-only viewer over the existing `AuditLog` model, ADMIN-only (also gated in `lib/route-guard.ts`).

| | |
| --- | --- |
| Route | `app/(console)/audit/page.tsx` (list only) |
| Actions | `lib/actions/audit-log.ts` — `queryAuditLog` (paginated, filter by user/entity/action/date-range/free-text) + `fetchAuditLogForExport` (CSV) |
| Components | `app/(console)/audit/audit-toolbar.tsx` — filters + **Export CSV** button (`GET /api/export?type=audit`, ADMIN) |

See [configuration.md](./configuration.md) for the environment/config side of Mail, SLA, and tokens.

### Notifications
Per-user in-app notification feed, shown as a **popover** opened from the topbar bell (no dedicated route).

| | |
| --- | --- |
| UI | `components/notifications-menu.tsx` — base-ui `Popover` in the topbar bell; loads on open |
| Actions | `lib/actions/notifications.ts` — `listNotifications`, `markAllRead`, `markRead` |
| Entity links | `ENTITY_HREF` map routes `Ticket`/`Problem`/`Change` notifications to their detail pages |

---

## Cross-cutting features

### Search
Global command palette (`Cmd/Ctrl+K` or `/`), not a route.

| | |
| --- | --- |
| Component | `components/command-menu.tsx` (mounted in the console layout) |
| Backend | `app/api/search/route.ts` — a Node route handler that fans out across tickets, problems, changes, assets, people, and services, returning grouped `{ group, href, title, sub }` results. Auth-gated via `getSessionUser`. Ticket matching reuses the shared cross-field helper in `lib/search.ts` (`ticketSearchWhere`). |

### CSAT surveys
A post-resolution satisfaction survey. On a ticket's resolution, `lib/actions/tickets.ts` mints a `SurveyResponse` row and the resolution email ([`lib/email-templates.ts`](../lib/email-templates.ts)) carries a token link. The rating page is **public and unauthenticated** (the token is the credential) — `proxy.ts` whitelists `/survey`.

| | |
| --- | --- |
| Public page | `app/survey/[token]/page.tsx` + `survey-form.tsx` (whitelisted in `proxy.ts`) |
| Actions | `lib/actions/survey.ts` — `ensureSurvey`, `surveyUrl` (builds the absolute link from `APP_URL`), `getSurveyByToken`, `submitSurvey` (one-time, gated by `respondedAt`) |
| Dashboard | the **csat** widget (`lib/dashboard/types.ts` + `compute.ts` + `components/dashboard/widget-card.tsx`) reports average rating + response count |

### Shared building blocks
Reused across every module, worth knowing before building UI:

| Component | Purpose |
| --- | --- |
| `components/page-header.tsx` | `PageHeader` + `PageBody` layout wrappers used by nearly every page |
| `components/list-toolbar.tsx`, `pagination-bar.tsx` | List filtering + pagination |
| `components/status-badge.tsx` | `StatusBadge` / `ToneBadge` (driven by `lib/constants.ts` metadata) |
| `components/comments/` | `comment-thread`, `composer-attachments` (shared comment UI) |
| `components/attachments/` | `attachment-list`, `attachments-card`, `file-upload` (paired with `lib/actions/attachments.ts` → `deleteAttachment`) |
| `components/history/entity-history.tsx` | Audit/history timeline |
| `components/edit-entity-dialog.tsx`, `confirm-dialog.tsx`, `empty-state.tsx`, `stat-card.tsx`, `combobox.tsx`, `combo-field.tsx` | Generic primitives |
| `components/ui/` | shadcn/base-ui design-system primitives — see [design-system.md](./design-system.md) |

---

## Portal (self-service)

The requester surface under `app/portal/*`, laid out by `app/portal/layout.tsx` with `components/portal/portal-nav.tsx`.

| Feature | Route | Purpose | Key files |
| --- | --- | --- | --- |
| Home | `app/portal/page.tsx` | Requester dashboard: hero with live search, own open tickets, popular answers, catalog preview | `components/portal/portal-hero`, `portal-search`; `db.ticket`/`catalogItem`/`article` |
| Search | `app/api/portal/search/route.ts` | Live help-center search over **public** KB, catalog, and the caller's own tickets | `components/portal/portal-search` |
| Catalog | `app/portal/catalog/page.tsx` | Browse published catalog items (search + category pills) | `components/catalog/catalog-browser`, `catalog-icon` |
| Request | `app/portal/request/[serviceId]/page.tsx` | Submit a catalog request (dynamic per-service form) | `components/portal/service-request-form`, `request-form`, `portal-attachments`; `lib/actions/catalog.ts` → `createCatalogRequest` → `lib/portal-tickets.ts` |
| New ticket | `app/portal/new/page.tsx` | Raise a plain support ticket | `lib/actions/portal.ts` → `createPortalTicket` → `lib/portal-tickets.ts` |
| My tickets | `app/portal/tickets/page.tsx`, `[id]/page.tsx` | Track own tickets, reply, attach files | `lib/actions/portal.ts` → `addPortalComment`; `components/portal/portal-comment`, `components/attachments/*` |
| Knowledge | `app/portal/knowledge/page.tsx`, `[slug]/page.tsx` | Read published, public-facing KB articles (search + category pills) | `components/portal/knowledge-browser`; only published/public articles surface |
| Ask Sable | widget in `app/portal/layout.tsx` | End-user AI assistant (see [ai.md](ai.md#sable-in-the-self-service-portal-end-users)) — uses the same assistant-ui `Thread` UI as the console, USER-scoped and still confirm-to-create | `components/portal/sable-widget`; `lib/portal-assistant.ts`; streaming route `app/api/portal/assistant/route.ts` + confirm-create `app/api/portal/assistant/create/route.ts` |

Portal write paths are deliberately narrow and share one routed core (`lib/portal-tickets.ts`): requesters (and Sable, acting as them, confirm-first) can only create tickets/catalog requests, reply on their **own** tickets, and stage attachments (images/PDF/`.eml`, re-parented onto the new ticket). Catalog requests pre-route to the item's service/category team; free-form tickets default to the Service Desk triage team. All privileged mutations stay in the console action files.

---

## Related docs

- [architecture.md](./architecture.md) — layers, request lifecycle, auth/role gating, `proxy.ts`
- [data-model.md](./data-model.md) — Prisma models behind these modules
- [rest-api.md](./rest-api.md) — API tokens and HTTP endpoints
- [../CONTRIBUTING.md](../CONTRIBUTING.md) — how to add a module the Servio way
