# Data model

The complete schema lives in [`prisma/schema.prisma`](../prisma/schema.prisma) (833 lines) and the enum
values that back its `String` columns live in [`lib/constants.ts`](../lib/constants.ts). This document is a
grouped reference; the schema file remains the single source of truth for exact field lists and indexes.

See also: [architecture.md](./architecture.md) for how the data layer fits into the app, and
[rest-api.md](./rest-api.md) for the API surface over these models.

## Datasource strategy

Servio ships one schema that runs on **SQLite in development** and **PostgreSQL in production** without
model changes. The provider is pinned to `sqlite` in both [`prisma/schema.prisma`](../prisma/schema.prisma)
and [`prisma/migrations/migration_lock.toml`](../prisma/migrations/migration_lock.toml); for a Postgres
deployment you switch the `datasource db` provider to `postgresql` and point `DATABASE_URL` at the server.
The portability is achieved through a few deliberate conventions:

| Convention | Why | Example |
| --- | --- | --- |
| **Enums are `String` columns**, not Prisma `enum` blocks | SQLite has no native enum type; keeps one schema across both databases | `status String @default("NEW")` on `Ticket` |
| **JSON stored as `String` (TEXT)** | SQLite has no JSON column type | `SyncSource.config`, `CatalogItem.formSchema`, `AutomationRule.conditions`/`actions`, `Ticket.formData`/`formSchema`, `AuditLog.meta` |
| **String PKs use `cuid()`** | Collision-free client-generatable IDs for most models | `id String @id @default(cuid())` |
| **Ticket/Problem/Change PKs are `Int @default(autoincrement())`** | Produce the sequential number for human reference codes | `Ticket.id` → `INC-0042` |
| **Enum values are validated in app code** (Zod) | The DB will not reject a bad string; validation happens before write | schemas in `lib/actions/*` |

### Human reference numbers

`Ticket`, `Problem`, and `Change` use an autoincrementing integer `id`. The display code (e.g. `INC-0042`)
combines that `id` with a prefix, via helpers in [`lib/constants.ts`](../lib/constants.ts) — there is no
separate `number` column:

```ts
// lib/constants.ts
prefixForType(type)      // "INCIDENT" → "INC", "REQUEST" → "REQ"
ticketRef(id, prefix)    // → "INC-0042" — pass the STORED Ticket.prefix (backwards-compatible: also
                         //   accepts a raw type and maps it)
problemRef(id)           // → "PRB-0007"
changeRef(id)            // → "CHG-0033"
```

Each number is zero-padded to 4 digits and incidents/requests share one sequence. **A ticket's prefix is
stored** (`Ticket.prefix`) and fixed at creation from its initial type, so switching a ticket's `type` later
(now editable in the Properties panel) leaves its reference number unchanged.

## Model catalog

Grouped by domain. Every field/relation below is verified against
[`prisma/schema.prisma`](../prisma/schema.prisma).

### Auth (Auth.js adapter)

Standard [`@auth/prisma-adapter`](https://authjs.dev) models plus a credentials extension. See
[configuration.md](./configuration.md) for auth setup.

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `User` | Person (agent or end-user); credentials + OAuth account holder | `email` (unique), `passwordHash` (bcrypt, for credentials login), `role`, `isVip`, `jobTitle`, `department`, `timezone`, `locale`, `isActive`, `syncSourceId`/`externalId` (link to import source), `lastLoginAt`; the hub of most relations |
| `Account` | OAuth provider account linked to a user | `provider` + `providerAccountId` (unique), tokens; `onDelete: Cascade` |
| `Session` | Database session token | `sessionToken` (unique), `expires` |
| `VerificationToken` | Email verification / magic-link tokens | `identifier` + `token` |

### RBAC

Roles are a `String` on `User` (`role`), not a separate table. Allowed values: `ADMIN | MANAGER | AGENT | USER`
(see `ROLES` in [`lib/constants.ts`](../lib/constants.ts)). Group-level roles live on `GroupMember`.

### Org / routing

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `Group` | Team, department, or vendor that owns work | `name` (unique), `type` (`TEAM`/`DEPARTMENT`/`VENDOR`), `managerId`, `autoAssign` strategy (`OFF`/`ROUND_ROBIN`/`LEAST_BUSY`), `lastAssignedUserId` (round-robin cursor); has members, tickets, problems, changes, assets |
| `GroupMember` | User membership in a group | `(groupId, userId)` unique; `role` (`MEMBER`/`LEAD`) |

> **Note:** Groups are the unit of assignment/auto-routing. The old `Queue` model and the "Board"/`/queues`
> page were removed — routing centres entirely on `Group`.

### Tickets (incidents & requests)

`Ticket` is the largest model and the core of the app.

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `Ticket` | An incident or service request | `id` (Int, autoincrement); `prefix` (stored `INC`/`REQ`, fixed at creation so the ref stays stable when `type` is switched); `type`, `status`, `priority`, `impact`, `urgency`, `source`, `isMajorIncident`, `pendingReason`/`pendingNote`, `resolutionCode`/`resolutionNote`, `mergedIntoId`, `parentId` (self-relation `parent`/`children` for sub-tickets, `SetNull` when the parent is deleted); `description` (plaintext twin) + `descriptionHtml` (sanitized rich text); routing FKs `requesterId`, `requestedByUserId` (nullable — who raised it *on behalf of* the requester), `assigneeId`, `groupId`, `categoryId`, `serviceId`, `catalogItemId`, `slaId`, `problemId`, `changeId`; catalog `formData`/`formSchema` snapshot; **SLA clock** fields (see below); relations to comments, watchers, attachments, assets, tasks, worklogs, approvals, links, merges, and a one-to-one `survey` (CSAT) |
| `TicketComment` | Reply or internal note on a ticket | `body` (plaintext) + `bodyHtml`, `isInternal`, `authorId`; has attachments |
| `Task` | Checklist item / subtask on a ticket | `title`, `done`, `order`, `assigneeId` |
| `WorkLog` | Time logged against a ticket (effort reporting) | `minutes`, `note`, `billable`, `loggedAt`, `userId` |
| `TicketMerge` | One merge of a source ticket into a target, with what is needed to undo it | `sourceId`, `targetId` (both cascade), `mergedById`; the source's pre-merge `previousStatus`/`previousClosedAt`/`previousApprovalState`; JSON lists of what the merge added to the target so `unmergeTicket` removes exactly that: `copiedCommentIds`, `copiedWatcherIds`, `copiedAssetIds`, `copiedLinkIds`, `movedAttachments` (`{id, commentId}` — files are re-pointed, not copied), `movedChildIds` (re-parented children), `withdrawnApprovalIds` (pending approvals cancelled on the source); `adoptedProblemId`/`adoptedChangeId` (taken over because the target had none); `undoneAt`/`undoneById` once reverted |
| `TicketLink` | Typed relationship between two tickets | `(ticketId, linkedTicketId)` unique; `type` (`RELATED`/`DUPLICATE`/`BLOCKS`/`CAUSED_BY`) |
| `TicketApproval` | Approval request on a ticket (catalog approvals) | `approverId`, `status` (`PENDING`/`APPROVED`/`REJECTED`/`CANCELLED` — withdrawn when the ticket is cancelled while awaiting approval), `stage` (Int, default 0 — multi-stage catalog approvals), `decidedAt` |
| `SurveyResponse` | Post-resolution CSAT survey (one per ticket) | `ticketId` (unique), `token` (unique — gates the public rating link), `rating` (`SURVEY_RATING_MIN`..`MAX`, i.e. 1–5), `comment`, `sentAt`, `respondedAt`; `onDelete: Cascade` |
| `Macro` | Reusable, ordered set of ticket actions an agent applies in one click | `name`, `description`, `actions` (JSON as TEXT: ordered `{type,value}[]`), `ownerId`, `isShared` |
| `TicketWatcher` | Users following a ticket | composite PK `(ticketId, userId)` |

**SLA clock fields on `Ticket`:** `dueDate` (manual agent due date), `dueAt`/`responseDueAt`/`resolveDueAt`
(computed from the SLA at create), `responseBreached`/`resolveBreached`, `pendingSince` + `pausedMs` (clock
pauses while `PENDING`/`ON_HOLD`), `escalatedAt` / `slaAtRiskNotifiedAt` (at-most-once markers so breach
escalation and at-risk notification each fire once), `firstResponseAt`, `resolvedAt`, `closedAt`. When the
SLA carries a `businessCalendar`, deadlines are computed in business time; otherwise the clock is wall-clock.
The derived clock state
(`ON_TRACK`, `AT_RISK`, `BREACHED`, `MET`, `PAUSED`, `NONE`) is computed in app code from these columns — see
`SLA_STATES` in [`lib/constants.ts`](../lib/constants.ts).

### Problems

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `Problem` | Root-cause record; groups related incidents | `id` (Int → `PRB-`), `status` (`NEW`/`INVESTIGATING`/`KNOWN_ERROR`/`RESOLVED`/`CLOSED`), `priority`, `impact`, `rootCause`, `workaround`, `assigneeId`, `groupId`, `categoryId`; has tickets, changes, comments |
| `ProblemComment` | Comment on a problem | `body`/`bodyHtml`, `isInternal`, `authorId` |

### Changes

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `Change` | Change request with a workflow lifecycle | `id` (Int → `CHG-`), `type` (`STANDARD`/`NORMAL`/`EMERGENCY`), `status` (11-state lifecycle incl. terminal `CANCELLED`), `risk`, `priority`, `impact`, `reason`, `implementationPlan`, `rollbackPlan`, `outcome` (`SUCCESSFUL`/`SUCCESSFUL_WITH_ISSUES`/`FAILED`/`ROLLED_BACK`), `closureNotes` (post-implementation review / lessons learned), `cancelReason`, `approvalRule` (`UNANIMOUS`/`QUORUM`/`PERCENT` — how CAB approvals resolve) + `approvalThreshold` (N for `QUORUM`, percent for `PERCENT`), `plannedStart`/`plannedEnd`/`actualStart`/`actualEnd`, `problemId`; has approvals, affected assets (CIs), tickets, comments |
| `ChangeComment` | Comment on a change | `body`/`bodyHtml`, `isInternal`, `authorId` |
| `ChangeApproval` | Per-approver decision on a change | `(changeId, approverId)` unique; `status` (`PENDING`/`APPROVED`/`REJECTED`, or `CANCELLED` when the seat is withdrawn because the board settled or the change was cancelled), `comment`, `decidedAt` |

### CMDB / assets

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `Asset` | Configuration item (hardware, VM, cloud, software) | `assetTag` (unique), `name`, `type` (12 values), `status`, hardware detail (`serial`, `model`, `manufacturer`, `ipAddress`, `macAddress`, `os`, `cpu`, `ramGb`, `storageGb`), lifecycle (`cost`, `purchaseDate`, `warrantyEnd`), `ownerId`, `groupId`, `locationId`, `syncSourceId`/`externalId`, `lastSeenAt`; relations to tickets, changes, and asset-to-asset relations |
| `AssetRelation` | Directed dependency edge between two assets | `(sourceId, targetId, type)` unique; `type` (`DEPENDS_ON`/`CONNECTS_TO`/`RUNS_ON`/`HOSTS`/`PART_OF`/`BACKS_UP`) |
| `TicketAsset` | Ticket ↔ affected-asset join | composite PK `(ticketId, assetId)` |
| `ServiceAsset` | Service ↔ supporting-CI join (CMDB service mapping) | composite PK `(serviceId, assetId)`, `createdAt` |
| `ChangeAsset` | Change ↔ affected-CI join (attach/detach via `lib/actions/change-assets.ts`; feeds automated impact/risk) | composite PK `(changeId, assetId)` |

### Locations

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `Location` | Self-referencing physical/logical location tree | `type` (`SITE`/`BUILDING`/`FLOOR`/`ROOM`/`DATACENTER`/`RACK`), `parentId` (self relation `LocationTree`), `address`/`city`/`country`; assets link via `Asset.locationId` |

### Catalog / knowledge

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `Category` | Self-referencing taxonomy tree | `parentId` (self relation `CategoryTree`), `(name, parentId)` unique; shared by tickets, problems, changes, services, articles, catalog items |
| `SLA` | Response/resolution targets | `name` (unique), `priority` (for auto-match), `responseMins`, `resolveMins`, `isActive`; optional `businessCalendarId` (working-hours clock; null = 24/7) and `escalationPolicyId` (tiered escalation) |
| `Service` | Operational business service (service health) | `name` (unique), `status` (`OPERATIONAL`/`DEGRADED`/`OUTAGE`/`MAINTENANCE`/`RETIRED`), `criticality`, `categoryId`, `ownerId`, `slaId` |
| `CatalogItem` | Requestable self-service catalog entry (portal form) | `name`, `formSchema` (JSON field defs as TEXT), `requiresApproval` + `approverId`, `estimatedDays`, `isPublished`, `order`; spawns tickets |
| `Article` | Knowledge-base article | `slug` (unique), `body` + `bodyFormat` (`markdown`/`plain`), `status` (`DRAFT`/`REVIEW`/`PUBLISHED`/`RETIRED`), `visibility` (`INTERNAL`/`PUBLIC`), `published` (denormalized mirror), `views`, `categoryId`, `authorId`; has revisions & attachments |
| `ArticleLink` | Polymorphic link from an article to a Ticket/Problem/Change (no FK on `entityId`, like `Approval`); cascades with the article | `(articleId, entityType, entityId)` unique; `createdById` (SetNull) |
| `ArticleRevision` | Append-only content snapshot per save/publish | `(articleId, version)` unique; `title`, `excerpt`, `body`, `note`, `editorId` |

> **Note:** `Service` (operational health) and `CatalogItem` (requestable form) are distinct models. The seed
> creates operational services in [`prisma/seed.ts`](../prisma/seed.ts) and catalog items in
> [`prisma/seed-extras.ts`](../prisma/seed-extras.ts).

`CatalogItem.approvalStages` (JSON as TEXT) holds an ordered array of stage descriptors (each an
`approverId` **or** a `groupId`) for multi-stage / group catalog approvals; `approverId` remains the
single-stage-0 fallback. See [modules.md](./modules.md#service-catalog-admin).

### SLA calendars & escalation

Business-hours SLA calendars and tiered escalation. An `SLA` optionally points at a `BusinessCalendar`
(so its clock counts only working hours) and an `EscalationPolicy` (staged actions as the clock elapses).
The business-time math lives in [`lib/business-hours.ts`](../lib/business-hours.ts) /
[`lib/sla.ts`](../lib/sla.ts) and escalation firing in [`lib/sla-escalation.ts`](../lib/sla-escalation.ts).

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `BusinessCalendar` | A named working-hours calendar the SLA clock honours | `name`, `timezone` (default `UTC`), `weeklyHours` (JSON as TEXT: per-weekday open/close windows); has `holidays`, `slas` |
| `Holiday` | A non-working day on a calendar (the clock pauses on it) | `(calendarId, date, name)`; `onDelete: Cascade` with its calendar |
| `EscalationPolicy` | A named, ordered set of escalation steps | `name`; has `steps`, `slas` |
| `EscalationStep` | One step: at `thresholdPercent` of SLA elapsed, run `action` | `order`, `thresholdPercent` (e.g. 50/75/100), `action` (`NOTIFY`/`REASSIGN`/`BUMP_PRIORITY`), `targetGroupId`/`targetUserId` (reassign/notify target), `bumpToPriority` (for `BUMP_PRIORITY`); `onDelete: Cascade` with its policy |

### Sync / integrations

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `SyncSource` | External system to import/export from | `name` (unique), `type` (8 values: LDAP … GLPI), `direction` (`IMPORT`/`EXPORT`/`BIDIRECTIONAL`), `scope` (`USERS`/`ASSETS`/`TICKETS`/`ALL`), `config` (JSON as TEXT), `schedule` (cron), `isActive`, `lastRunAt`, `lastStatus`; has runs, imported users & assets |
| `SyncRun` | One execution of a sync source | `status`, `trigger` (`MANUAL`/`SCHEDULE`; `API` is reserved — no code path yet, `sync-runner.ts` only ever writes `MANUAL` or `SCHEDULE`), counters `created`/`updated`/`failed`, `log`, `startedAt`/`finishedAt` |

### Attachments, audit, notifications, email

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `Attachment` | Uploaded blob (driver-agnostic) | `storageKey` (`YYYY/MM/<id>-<name>`), `checksum` (sha256), `mime`, `size`; nullable FKs to `ticket`/`comment`/`article`, plus `uploadedBy`; `url` kept for legacy/external only |
| `AuditLog` | Immutable activity record | `action`, `entity` + `entityId`, `summary`, `meta` (JSON as TEXT), `ip`, optional `userId` |
| `Notification` | Per-user in-app notification | `type`, `title`, `body`, `entity`/`entityId`, `read`; indexed `(userId, read)` |
| `EmailMessage` | Email record / queue (outbound + inbound) | `direction` (`OUTBOUND`/`INBOUND`), `toEmail`, `subject`, `body`, `template`, `status` (`QUEUED`/`SENT`/`SIMULATED`/`FAILED`/`RECEIVED`), `error`, `entity`/`entityId`, `sentAt` |

### API tokens

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `ApiToken` | Personal access token for the REST API | `tokenHash` (unique, bcrypt), `prefix` (display), `scopes` (csv: `read,write,admin`), `userId`, `lastUsedAt`, `expiresAt`, `revoked`. See [rest-api.md](./rest-api.md). |

### Automations

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `AutomationRule` | Condition→action rule run on ticket events | `trigger` (`TICKET_CREATED`/`TICKET_UPDATED`/`TICKET_SLA_AT_RISK`/`TICKET_SLA_BREACHED`), `matchType` (`ALL`/`ANY`), `conditions` and `actions` (JSON arrays as TEXT), `isActive`, `order`, `runCount`, `lastRunAt` |

### AI assistant (Sable)

The models keep their `Ai*` names; the assistant's display name is now **Sable** (`AI_ASSISTANT_NAME` in `lib/constants.ts`).

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `AiConversation` | A persisted Sable chat (the `/assistant` surface) | `title` (auto-titled from the first message), `scope` (`GENERAL`/`ADMIN`), `archived`, `userId`, `folderId` (nullable, `SetNull` on folder delete); indexed `(userId, archived, updatedAt)` for the newest-first left rail and `(folderId)` |
| `AiFolder` | A per-user folder to organise conversations in the left rail | `name`, `userId`; has many `AiConversation`; indexed `(userId, updatedAt)`. Deleting a folder just un-groups its chats (`SetNull`) — it never deletes conversations |
| `AiMessage` | One turn in a conversation | `role` (`user`/`assistant`), `content`, `html` (sanitized markdown, assistant turns), `toolCalls` (JSON as TEXT), `proposals` (JSON as TEXT); indexed `(conversationId, createdAt)`, cascades with its conversation |
| `AiProposalDecision` | The user's decision on one Sable approve-first proposal | `proposalKey` (tool call + operation/args signature, unique per conversation), `status` (`APPLYING`/`APPLIED`/`DISMISSED`), `claimId` (token of the request applying it), `summary`; cascades with its conversation |
| `AiSkill` | An admin-managed custom Sable skill (a `SKILL.md`), synced into Sable's agent home | `name` (unique, kebab-case, must not collide with a built-in), `description`, `body` (markdown without frontmatter), `enabled`. Built-in skills live in `sable/skills/`; their disabled state is the `SABLE_DISABLED_SKILLS` setting |
| `AiMcpServer` | A remote (HTTP/SSE) MCP server whose tools Sable may use | `name` (unique slug), `url`, `transport` (`AI_MCP_TRANSPORTS`), `headers` (encrypted JSON, nullable), `mode` (`AI_MCP_MODES`: `READ_ONLY`/`APPROVAL`/`TRUSTED`), `minRole`, `enabled` |

Sable's *actions* are not stored as models — its write operations are RBAC-gated proposals defined
in code (`lib/ai-operations/*`) and applied through the normal server actions, which write their
own `AuditLog` rows. See [ai.md](./ai.md).

### Personalisation (saved views & dashboards)

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `SavedView` | A named set of list filters (per-user, optionally team-shared) | `name`, `entity` (default `ticket`), `filters` (JSON of URL params), `ownerId`, `isShared`, `groupId` (scope a shared view to one team), `order` |
| `Dashboard` | A customizable widget dashboard | `name`, `ownerId`, `isShared`, `groupId`, `layout` (JSON `Widget[]` on a 12-column grid), `order`. Each user gets a personal **"My Dashboard"** on first visit; managers/admins can share dashboards with a team or everyone |

Widget definitions live in code, not the DB — `lib/dashboard/types.ts` (`Widget`, widget types, the
`DEFAULT_LAYOUT`) and `lib/dashboard/compute.ts` (server-side metric engine). Each widget carries its own
`filters` and an optional accent colour / value thresholds. See [modules.md](./modules.md#dashboards).

## Enums

Every "enum" is a `String` column whose allowed values are declared as a `readonly` tuple in
[`lib/constants.ts`](../lib/constants.ts). Each domain also exports a `*_META` map with a human label, a badge
`tone`, and (often) a Lucide icon, so a value renders consistently everywhere. `TONE_CLASSES` maps each tone to its
badge classes; the derived `TONE_BANNER_CLASSES` / `TONE_TEXT_CLASSES` reuse the same palette for full-width status
banner tints and standalone accent text/icons, so call sites never hand-pick raw palette utilities.

| Constant | Backs | Allowed values |
| --- | --- | --- |
| `ROLES` | `User.role` | `ADMIN`, `MANAGER`, `AGENT`, `USER` |
| `TICKET_TYPES` | `Ticket.type` | `INCIDENT`, `REQUEST` |
| `TICKET_STATUSES` | `Ticket.status` | `NEW`, `OPEN`, `IN_PROGRESS`, `PENDING`, `ON_HOLD`, `RESOLVED`, `CLOSED`, `CANCELLED` |
| `OPEN_TICKET_STATUSES` | (subset) | `NEW`, `OPEN`, `IN_PROGRESS`, `PENDING`, `ON_HOLD` |
| `PENDING_STATUSES` | (subset) | `PENDING`, `ON_HOLD` |
| `PENDING_REASONS` | `Ticket.pendingReason` | `AWAITING_CUSTOMER`, `AWAITING_VENDOR`, `AWAITING_CHANGE`, `AWAITING_PARTS`, `SCHEDULED` |
| `RESOLUTION_CODES` | `Ticket.resolutionCode` | `FIXED`, `WORKAROUND`, `NOT_REPRODUCIBLE`, `DUPLICATE`, `NO_ACTION` |
| `PRIORITIES` | `*.priority` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `IMPACT_URGENCY` | `*.impact`, `*.urgency` | `LOW`, `MEDIUM`, `HIGH` |
| `TICKET_SOURCES` | `Ticket.source` | `PORTAL`, `SABLE`, `EMAIL`, `PHONE`, `API`, `AGENT` |
| `PROBLEM_STATUSES` | `Problem.status` | `NEW`, `INVESTIGATING`, `KNOWN_ERROR`, `RESOLVED`, `CLOSED` |
| `CHANGE_TYPES` | `Change.type` | `STANDARD`, `NORMAL`, `EMERGENCY` |
| `CHANGE_STATUSES` | `Change.status` | `DRAFT`, `APPROVAL`, `APPROVED`, `SCHEDULED`, `IN_PROGRESS`, `REVIEW`, `CLOSED`, `REJECTED`, `FAILED`, `CANCELLED` |
| `CHANGE_OUTCOMES` | `Change.outcome` | `SUCCESSFUL`, `SUCCESSFUL_WITH_ISSUES`, `FAILED`, `ROLLED_BACK` |
| `ARTICLE_LINK_ENTITY_TYPES` | `ArticleLink.entityType` | `TICKET`, `PROBLEM`, `CHANGE` |
| `RISKS` | `Change.risk` | `LOW`, `MEDIUM`, `HIGH` |
| `CAB_APPROVAL_RULES` | `Change.approvalRule` | `UNANIMOUS`, `QUORUM`, `PERCENT` |
| `ESCALATION_ACTIONS` | `EscalationStep.action` | `NOTIFY`, `REASSIGN`, `BUMP_PRIORITY` |
| `APPROVAL_STATUSES` | `TicketApproval.status`, `ChangeApproval.status`, `Approval.status`, `Ticket.approvalState` | `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED` |
| `SERVICE_STATUSES` | `Service.status` | `OPERATIONAL`, `DEGRADED`, `OUTAGE`, `MAINTENANCE`, `RETIRED` |
| `CRITICALITIES` | `Service.criticality` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `AUTO_ASSIGN_STRATEGIES` | `Group.autoAssign` | `OFF`, `ROUND_ROBIN`, `LEAST_BUSY` |
| `GROUP_TYPES` | `Group.type` | `TEAM`, `DEPARTMENT`, `VENDOR` |
| `ASSET_TYPES` | `Asset.type` | `SERVER`, `WORKSTATION`, `LAPTOP`, `NETWORK`, `SOFTWARE`, `MOBILE`, `PRINTER`, `VM`, `CLOUD`, `SERVICE`, `MONITOR`, `PHONE` |
| `ASSET_STATUSES` | `Asset.status` | `IN_USE`, `IN_STOCK`, `MAINTENANCE`, `RETIRED`, `DISPOSED` |
| `ASSET_RELATION_TYPES` | `AssetRelation.type` | `DEPENDS_ON`, `CONNECTS_TO`, `RUNS_ON`, `HOSTS`, `PART_OF`, `BACKS_UP` |
| `SYNC_TYPES` | `SyncSource.type` | `LDAP`, `ACTIVE_DIRECTORY`, `AZURE_AD`, `INTUNE`, `CSV`, `SNOW`, `REST_API`, `GLPI` |
| `SYNC_DIRECTIONS` | `SyncSource.direction` | `IMPORT`, `EXPORT`, `BIDIRECTIONAL` |
| `SYNC_SCOPES` | `SyncSource.scope` | `USERS`, `ASSETS`, `TICKETS`, `ALL` |
| `SYNC_RUN_STATUSES` | `SyncRun.status`, `SyncSource.lastStatus` | `RUNNING`, `SUCCESS`, `FAILED`, `PARTIAL` |
| `SLA_STATES` | derived SLA clock state | `ON_TRACK`, `AT_RISK`, `BREACHED`, `MET`, `PAUSED`, `NONE` |
| `ARTICLE_STATUSES` | `Article.status` | `DRAFT`, `REVIEW`, `PUBLISHED`, `RETIRED` |
| `ARTICLE_VISIBILITIES` | `Article.visibility` | `INTERNAL`, `PUBLIC` |
| `LOCATION_TYPES` | `Location.type` | `SITE`, `BUILDING`, `FLOOR`, `ROOM`, `DATACENTER`, `RACK` |
| `TICKET_LINK` types | `TicketLink.type` | `RELATED`, `DUPLICATE`, `BLOCKS`, `CAUSED_BY` *(defined inline on the schema, not exported as a constant)* |

There is no `lib/enums.ts` — all enum tuples and their metadata live in
[`lib/constants.ts`](../lib/constants.ts). The file also holds a few cross-cutting non-enum exports, most notably
`APP_VERSION` (kept in sync with `package.json` "version"; shown in the sidebar footer and Settings › About).

### Enums as the single source of truth

The pattern keeps one authoritative list per domain:

1. **`lib/constants.ts` declares** the `readonly` tuple (`export const X = [...] as const`), a derived
   TypeScript union type, and the `*_META` map (`label`, `tone`, `icon`).
2. **Zod schemas** in the server actions validate incoming values against those tuples before any write, so
   the plain `String` DB column can never be persisted with an out-of-range value from the app.
3. **UI components** read the same tuples to build `<Select>` option lists and the `*_META` maps to render
   status/priority badges, guaranteeing DB, validation, and UI never drift.
4. The `metaFor(map, key)` helper provides a safe fallback (`{ label: key, tone: "neutral" }`) for legacy or
   unknown values.

To add or change an allowed value, edit the tuple and its `*_META` entry in `lib/constants.ts` — no schema
migration is required, since the column is already a `String`.

## Migration workflow

Prisma migrations live in [`prisma/migrations/`](../prisma/migrations/). The seed is split across
[`prisma/seed.ts`](../prisma/seed.ts) (users, groups, tickets, problems, changes, assets, services, sync,
articles) and [`prisma/seed-extras.ts`](../prisma/seed-extras.ts) (locations, catalog items, automation
rules); `package.json` runs both via the `prisma.seed` hook (`tsx prisma/seed.ts && tsx prisma/seed-extras.ts`).

| Command | Runs | Use when |
| --- | --- | --- |
| `pnpm db:generate` | `prisma generate` | Regenerate the Prisma Client after editing the schema |
| `pnpm db:migrate` | `prisma migrate dev` | Create + apply a new migration in development (prompts for a name) |
| `pnpm db:push` | `prisma db push` | Push schema changes to the DB **without** a migration file (fast prototyping) |
| `pnpm db:reset` | `prisma migrate reset --force` | Drop, re-apply all migrations, and re-seed from scratch |
| `pnpm db:seed` | both seed scripts | (Re)populate demo data into the current DB |
| `pnpm db:studio` | `prisma studio` | Browse/edit data in the Prisma Studio GUI |
| `pnpm setup` | `prisma migrate deploy && prisma db seed` | Production/CI: apply pending migrations then seed |

Typical local loop: edit `prisma/schema.prisma` → `pnpm db:migrate` (name the migration) → `pnpm db:seed` if
you need fresh demo data. Use `pnpm db:reset` to get back to a known clean state.

The demo login created by the seed is `admin@servio.dev` / `servio123`.

### Migration baseline

The history is a **single squashed baseline** (`20260823000000_init_baseline`) that
creates the full schema in one migration — the nine original incremental
migrations (2026-08-08/09) had drifted far behind the schema (23 models were
never migrated, which broke `pnpm setup`/`db:reset`) and were collapsed after
every finding was remediated. The baseline is verified drift-free against
`prisma/schema.prisma` (`prisma migrate diff` reports no difference); local
development keeps using `pnpm db:push`, while `pnpm setup` (migrate deploy +
seed) works on any fresh database. The provider lock is `sqlite`
([`prisma/migrations/migration_lock.toml`](../prisma/migrations/migration_lock.toml)); switching to Postgres
for production means changing both the `datasource` provider and this lock, then regenerating the migration
history for the new engine.
