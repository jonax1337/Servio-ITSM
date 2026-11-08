# Data model

The complete schema lives in [`prisma/schema.prisma`](../prisma/schema.prisma) (about 1,870 lines) and the enum
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
| **Ticket/Problem/Change/Release PKs are `Int @default(autoincrement())`** | Produce the sequential number for human reference codes | `Ticket.id` → `INC-0042` |
| **Large counters are `Float`, not `Int`/`BigInt`** | A 32-bit `Int` overflows; `BigInt` would surface as a JS `bigint` (breaks number math and `JSON.stringify`); a double holds whole numbers exactly up to 2^53 | `Ticket.pausedMs` (ms), `Attachment.size` (bytes). Widened by migration `20261109000000_widen_int_overflow_columns` |
| **Enum values are validated in app code** (Zod) | The DB will not reject a bad string; validation happens before write | schemas in `lib/actions/*` |

### Human reference numbers

`Ticket`, `Problem`, `Change`, and `Release` use an autoincrementing integer `id`. The display code (e.g. `INC-0042`)
combines that `id` with a prefix, via helpers in [`lib/constants.ts`](../lib/constants.ts) — there is no
separate `number` column:

```ts
// lib/constants.ts
prefixForType(type)      // "INCIDENT" → "INC", "REQUEST" → "REQ"
ticketRef(id, prefix)    // → "INC-0042" — pass the STORED Ticket.prefix (backwards-compatible: also
                         //   accepts a raw type and maps it)
problemRef(id)           // → "PRB-0007"
changeRef(id)            // → "CHG-0033"
releaseRef(id)           // → "REL-0001"
parseTicketRef(text)     // reverse: pulls INC-/REQ- refs out of text such as an email subject
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
| `User` | Person (agent or end-user); credentials + OAuth account holder | `email` (unique), `passwordHash` (bcrypt, for credentials login), `role`, `isVip`, `jobTitle`, `phone`, `department`, `timezone`, `locale`, `signature` (sanitized HTML) + `signatureEnabled` (appended to replies/emails), `isActive`, `syncSourceId`/`externalId` (link to import source, unique together), `lastLoginAt`; the hub of most relations |
| `Account` | OAuth provider account linked to a user | `provider` + `providerAccountId` (unique), tokens; `onDelete: Cascade` |
| `Session` | Database session token | `sessionToken` (unique), `expires` |
| `VerificationToken` | Email verification / magic-link tokens | `identifier` + `token` |

### RBAC

Roles are a `String` on `User` (`role`), not a separate table. Allowed values: `ADMIN | MANAGER | AGENT | USER`
(see `ROLES` in [`lib/constants.ts`](../lib/constants.ts)). Group-level roles live on `GroupMember`.

### Runtime settings

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `AppSetting` | Admin-managed runtime configuration (SMTP, AI, branding, uploads, …); overrides the matching `process.env` key | `key` (unique), `value`, `encrypted` (secrets are AES-256-GCM encrypted at rest, see `lib/settings.ts` / `lib/crypto.ts`), `updatedById`. Also stores the update-check cache (see Maintenance windows) |

### Org / routing

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `Group` | Team, department, or vendor that owns work | `name` (unique), `type` (`TEAM`/`DEPARTMENT`/`VENDOR`), `email`, `color`, `managerId`, `autoAssign` strategy (`OFF`/`ROUND_ROBIN`/`LEAST_BUSY`), `lastAssignedUserId` (round-robin cursor); has members, tickets, problems, changes, assets, on-call schedules, freeze windows, releases, change templates |
| `GroupMember` | User membership in a group | `(groupId, userId)` unique; `role` (`MEMBER`/`LEAD`) |

> **Note:** Groups are the unit of assignment/auto-routing. The old `Queue` model and the "Board"/`/queues`
> page were removed — routing centres entirely on `Group`.

### Tickets (incidents & requests)

`Ticket` is the largest model and the core of the app.

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `Ticket` | An incident or service request | `id` (Int, autoincrement); `prefix` (stored `INC`/`REQ`, fixed at creation so the ref stays stable when `type` is switched); `type`, `status`, `priority`, `impact`, `urgency`, `source`, `isMajorIncident`, `pendingReason`/`pendingNote`, `resolutionCode`/`resolutionNote`, `mergedIntoId`, `parentId` (self-relation `parent`/`children` for sub-tickets, `SetNull` when the parent is deleted); `description` (plaintext twin) + `descriptionHtml` (sanitized rich text); routing FKs `requesterId`, `requestedByUserId` (nullable — who raised it *on behalf of* the requester), `assigneeId`, `groupId`, `categoryId`, `serviceId`, `catalogItemId`, `slaId`, `problemId`, `changeId`; catalog `formData`/`formSchema` snapshot; `customFields` (JSON values keyed by `CustomFieldDef.key`); `approvalState` (nullable, `APPROVAL_STATUSES`); **SLA clock** fields (see below); relations to comments, watchers, participants, notified contacts, emails, attachments, assets, tasks, worklogs, approvals, links, merges, and a one-to-one `survey` (CSAT); `importRef` (unique, nullable): origin of a record created by the history import (`/api/v1/import/*`). |
| `TicketComment` | Reply or internal note on a ticket | `body` (plaintext) + `bodyHtml`, `isInternal`, `channel` (`WEB`/`EMAIL`/`FORWARD`: how the reply arrived), `fromEmail` (external sender), `emailMessageId` (inbound mail that produced it), `authorId`; has attachments |
| `Task` | Checklist item / subtask on a ticket | `title`, `done`, `order`, `assigneeId` |
| `WorkLog` | Time logged against a ticket (effort reporting) | `minutes`, `note`, `billable`, `loggedAt`, `userId` |
| `TicketMerge` | One merge of a source ticket into a target, with what is needed to undo it | `sourceId`, `targetId` (both cascade), `mergedById`; the source's pre-merge `previousStatus`/`previousClosedAt`/`previousApprovalState`; JSON lists of what the merge added to the target so `unmergeTicket` removes exactly that: `copiedCommentIds`, `copiedWatcherIds`, `copiedAssetIds`, `copiedLinkIds`, `movedAttachments` (`{id, commentId}` — files are re-pointed, not copied), `movedChildIds` (re-parented children), `withdrawnApprovalIds` (pending approvals cancelled on the source); `adoptedProblemId`/`adoptedChangeId` (taken over because the target had none); `undoneAt`/`undoneById` once reverted |
| `TicketLink` | Typed relationship between two tickets | `(ticketId, linkedTicketId)` unique; `type` (`RELATED`/`DUPLICATE`/`BLOCKS`/`CAUSED_BY`) |
| `TicketApproval` | Approval request on a ticket (catalog approvals) | `approverId`, `status` (`PENDING`/`APPROVED`/`REJECTED`/`CANCELLED` — withdrawn when the ticket is cancelled while awaiting approval), `stage` (Int, default 0 — multi-stage catalog approvals), `decidedAt` |
| `SurveyResponse` | Post-resolution CSAT survey (one per ticket) | `ticketId` (unique), `token` (unique — gates the public rating link), `rating` (`SURVEY_RATING_MIN`..`MAX`, i.e. 1–5), `comment`, `sentAt`, `respondedAt`; `onDelete: Cascade` |
| `Macro` | Reusable, ordered set of ticket actions an agent applies in one click | `name`, `description`, `actions` (JSON as TEXT: ordered `{type,value}[]`), `ownerId`, `isShared` |
| `TicketWatcher` | Internal followers (agents) who get in-app notifications for a ticket | composite PK `(ticketId, userId)` |
| `TicketParticipant` | Customer-side collaborator (e.g. the requester's manager): can see and reply in the portal and is CC'd on customer-facing mail; distinct from a watcher | composite PK `(ticketId, userId)`, `addedById` |
| `TicketNotifiedContact` | External party a ticket was forwarded to; has no portal access, and its email replies land as internal comments | `(ticketId, email)` unique, `name`, `notifiedById` |

**SLA clock fields on `Ticket`:** `dueDate` (manual agent due date), `dueAt`/`responseDueAt`/`resolveDueAt`
(computed from the SLA at create), `responseBreached`/`resolveBreached`, `pendingSince` + `pausedMs` (clock
pauses while `PENDING`/`ON_HOLD`; `pausedMs` is a `Float` of whole milliseconds because a 32-bit `Int`
overflows after ~24.8 days of pause), `escalatedAt` / `slaAtRiskNotifiedAt` (at-most-once markers so breach
escalation and at-risk notification each fire once), `firstResponseAt`, `resolvedAt`, `closedAt`. When the
SLA carries a `businessCalendar`, deadlines are computed in business time; otherwise the clock is wall-clock.
The derived clock state
(`ON_TRACK`, `AT_RISK`, `BREACHED`, `MET`, `PAUSED`, `NONE`) is computed in app code from these columns — see
`SLA_STATES` in [`lib/constants.ts`](../lib/constants.ts).

### Problems

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `Problem` | Root-cause record; groups related incidents | `id` (Int → `PRB-`), `status` (`NEW`/`INVESTIGATING`/`KNOWN_ERROR`/`RESOLVED`/`CLOSED`), `priority`, `impact`, `description` + `descriptionHtml`, `rootCause`, `workaround`, `customFields`, `assigneeId`, `groupId`, `categoryId`, `resolvedAt`; has tickets, changes, comments; `importRef` (unique, nullable): origin of a record created by the history import (`/api/v1/import/*`). |
| `ProblemComment` | Comment on a problem | `body`/`bodyHtml`, `isInternal`, `authorId` |

### Changes

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `Change` | Change request with a workflow lifecycle | `id` (Int → `CHG-`), `type` (`STANDARD`/`NORMAL`/`EMERGENCY`), `status` (10-state lifecycle incl. terminal `CANCELLED`), `risk`, `priority`, `impact`, `reason`, `implementationPlan`, `rollbackPlan`, `outcome` (`SUCCESSFUL`/`SUCCESSFUL_WITH_ISSUES`/`FAILED`/`ROLLED_BACK`), `closureNotes` (post-implementation review / lessons learned), `cancelReason`, `approvalRule` (`UNANIMOUS`/`QUORUM`/`PERCENT` — how CAB approvals resolve) + `approvalThreshold` (N for `QUORUM`, percent for `PERCENT`), `customFields`, `plannedStart`/`plannedEnd`/`actualStart`/`actualEnd`, `assigneeId`, `createdById`, `groupId`, `categoryId`, `problemId`, `releaseId`, `templateId`; has approvals, affected assets (CIs), tickets, comments; `importRef` (unique, nullable): origin of a record created by the history import (`/api/v1/import/*`). |
| `ChangeComment` | Comment on a change | `body`/`bodyHtml`, `isInternal`, `authorId` |
| `ChangeApproval` | Per-approver decision on a change | `(changeId, approverId)` unique; `status` (`PENDING`/`APPROVED`/`REJECTED`, or `CANCELLED` when the seat is withdrawn because the board settled or the change was cancelled), `comment`, `decidedAt` |

### Custom fields, workflow & ad-hoc approvals

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `CustomFieldDef` | Admin-defined extra field on tickets, problems or changes; the values live in each entity's `customFields` JSON | `(entityType, key)` unique (`entityType` is `TICKET`/`PROBLEM`/`CHANGE`), `label`, `type` (`text`/`textarea`/`select`/`number`/`date`/`checkbox`), `options` (JSON array, for `select`), `required`, `placeholder`, `help`, `matchType` (`ALL`/`ANY`) + `visibility` (JSON array of automation-shaped `{field,op,value}` conditions), `order`, `active` |
| `StatusTransition` | Admin override of one built-in status transition (see `lib/workflow.ts`); no row means the built-in default (allowed, any agent) | `(entityType, fromStatus, toStatus)` unique, `allowed`, `requiredRole` (null = any agent, else `MANAGER`/`ADMIN`) |
| `Approval` | Polymorphic, manually requested sign-off on any Ticket, Problem, Change or Service. Separate from the automated flows (`ChangeApproval` CAB, `TicketApproval` catalog) and never drives the entity lifecycle | `entityType` (`APPROVAL_ENTITY_TYPES`), `entityId` (stringified id, no FK), `title`, `approverId`, `requestedById`, `status` (`PENDING`/`APPROVED`/`REJECTED`), `comment`, `decidedAt`; `(entityType, entityId, approverId)` unique |

### CMDB / assets

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `Asset` | Configuration item (hardware, VM, cloud, software) | `assetTag` (unique), `name`, `type` (12 values), `status`, hardware detail (`serial`, `model`, `manufacturer`, `ipAddress`, `macAddress`, `os`, `cpu`, `ramGb`, `storageGb`), lifecycle (`cost`, `purchaseDate`, `warrantyEnd`), `ownerId`, `groupId`, `location` (free text) and `locationId`, `syncSourceId`/`externalId` (unique together), `lastSeenAt`; relations to tickets, changes, services, contracts, license assignments, and asset-to-asset relations; `importRef` (unique, nullable): origin key set by the API (`PUT /api/v1/assets/ref/{ref}`) for syncs and imports |
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
| `Category` | Self-referencing taxonomy tree | `parentId` (self relation `CategoryTree`), `(name, parentId)` unique, `groupId` (handling team, informational, not auto-routing), `archived` (hidden from pickers/portal; existing tickets keep it); shared by tickets, problems, changes, services, articles, catalog items, change templates |
| `SLA` | Response/resolution targets | `name` (unique), `priority` (for auto-match), `responseMins`, `resolveMins`, `isActive`; optional `businessCalendarId` (working-hours clock; null = 24/7) and `escalationPolicyId` (tiered escalation) |
| `Service` | Operational business service (service health) | `name` (unique), `status` (`OPERATIONAL`/`DEGRADED`/`OUTAGE`/`MAINTENANCE`/`RETIRED`), `criticality`, `categoryId`, `ownerId`, `slaId`, `groupId` (team that runs it, used to pre-route catalog requests); supporting CIs via `ServiceAsset` |
| `CatalogItem` | Requestable self-service catalog entry (portal form) | `name`, `shortDescription`, `serviceId` (the service the request maps to; pre-routes the ticket), `formSchema` (JSON field defs as TEXT), `requiresApproval` + `approverId`, `estimatedDays`, `isPublished`, `order`; spawns tickets |
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
| `EscalationStep` | One step: at `thresholdPercent` of SLA elapsed, run `action` | `order`, `thresholdPercent` (e.g. 50/75/100), `action` (`NOTIFY`/`REASSIGN`/`BUMP_PRIORITY`/`NOTIFY_ONCALL`/`REASSIGN_ONCALL`; the on-call actions resolve the current on-call of the ticket's team), `targetGroupId`/`targetUserId` (reassign/notify target), `bumpToPriority` (for `BUMP_PRIORITY`); `onDelete: Cascade` with its policy |

### Sync / integrations

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `SyncSource` | External system to import/export from | `name` (unique), `type` (8 values: LDAP … GLPI), `direction` (`IMPORT`/`EXPORT`/`BIDIRECTIONAL`), `scope` (`USERS`/`ASSETS`/`TICKETS`/`ALL`), `config` (JSON as TEXT), `schedule` (cron), `isActive`, `lastRunAt`, `lastStatus`; has runs, imported users & assets |
| `SyncRun` | One execution of a sync source | `status`, `trigger` (`MANUAL`/`SCHEDULE`; `API` is reserved — no code path yet, `sync-runner.ts` only ever writes `MANUAL` or `SCHEDULE`), counters `created`/`updated`/`failed`, `log`, `startedAt`/`finishedAt` |

### Attachments, audit, notifications, email

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `Attachment` | Uploaded blob (driver-agnostic) | `storageKey` (`YYYY/MM/<id>-<name>`), `checksum` (sha256), `mime`, `size` (bytes, `Float`), nullable FKs to `ticket`/`comment`/`article`/`change`/`problem`/`asset`/`license` (all `Cascade`; a file has at most one parent, a comment file carries only `commentId`), plus `uploadedBy`; `createdAt` may be set by a history import (REST API); `url` kept for legacy/external only; also the blob behind an `AiProjectFile` |
| `AuditLog` | Immutable activity record | `action`, `entity` + `entityId`, `summary`, `meta` (JSON as TEXT), `ip`, optional `userId` |
| `Notification` | Per-user in-app notification | `type`, `title`, `body`, `entity`/`entityId`, `read`; indexed `(userId, read)` |
| `EmailMessage` | Email record / queue (outbound + inbound) and the anchor of a mail thread | `direction` (`OUTBOUND`/`INBOUND`), `toEmail`/`toName`, `fromEmail`/`fromName`, `cc`/`bcc` (JSON arrays), `replyTo`, `subject`, `body` + `bodyHtml`, `template`, `status` (`QUEUED`/`SENT`/`SIMULATED`/`FAILED`/`RECEIVED`), `error`, RFC 2822 threading (`messageId` unique, `inReplyTo`, `references`, `headers`), `entity`/`entityId`, `ticketId` (direct FK, `SetNull`), `commentId`, `sentAt` |
| `EmailTemplate` | Admin-editable email template; a missing or disabled row falls back to the built-in default in `lib/email-templates.ts` | `key` (primary key, e.g. `ticket_received`), `subject`, `bodyHtml` (with `{{placeholders}}`), `enabled`, `updatedById` |

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
| `AiConversation` | A persisted Sable chat (the `/assistant` surface) | `title` (auto-titled from the first message), `scope` (`GENERAL`/`ADMIN`; a legacy hint, admin operations are gated per operation), `archived`, `userId`, `folderId` (nullable, `SetNull` on folder delete), `projectId` (nullable, `SetNull` on project delete); indexed `(userId, archived, updatedAt)` for the newest-first left rail, `(folderId)` and `(projectId)` |
| `AiFolder` | A per-user folder to organise conversations in the left rail | `name`, `userId`; has many `AiConversation`; indexed `(userId, updatedAt)`. Deleting a folder just un-groups its chats (`SetNull`) — it never deletes conversations |
| `AiMessage` | One turn in a conversation | `role` (`user`/`assistant`), `content`, `html` (sanitized markdown, assistant turns), `toolCalls` (JSON as TEXT), `proposals` (JSON as TEXT); indexed `(conversationId, createdAt)`, cascades with its conversation |
| `AiProposalDecision` | The user's decision on one Sable approve-first proposal | `proposalKey` (tool call + operation/args signature, unique per conversation), `status` (`APPLYING`/`APPLIED`/`DISMISSED`), `claimId` (token of the request applying it), `summary`; cascades with its conversation |
| `AiSkill` | An admin-managed custom Sable skill (a `SKILL.md`), synced into Sable's agent home | `name` (unique, kebab-case, must not collide with a built-in), `description`, `body` (markdown without frontmatter), `enabled`. Built-in skills live in `sable/skills/`; their disabled state is the `SABLE_DISABLED_SKILLS` setting |
| `AiMcpServer` | A remote (HTTP/SSE) MCP server whose tools Sable may use | `name` (unique slug), `url`, `transport` (`AI_MCP_TRANSPORTS`: `http`/`sse`), `headers` (encrypted JSON, nullable), `mode` (`AI_MCP_MODES`: `READ_ONLY`/`APPROVAL`/`TRUSTED`), `minRole`, `enabled` |
| `AiProject` | A persistent Sable workspace owning conversations, a foldered file library and custom instructions; personal by default, optionally shared with a team | `userId` (owner, `Cascade`), `name`, `description`, `instructions` (injected into every system prompt of the project), `archived`, `isShared` + `groupId` (`SetNull`), optional ITSM binding `changeId`/`problemId`/`ticketId` (all `SetNull`) |
| `AiProjectFolder` | A folder inside a project's file library | `projectId` (`Cascade`), `parentId` (self relation `AiProjectFolderTree`, `SetNull`), `name`. Deleting a folder un-nests its children and files; it never deletes blobs |
| `AiProjectFile` | A file in a project's library; the bytes live in the linked `Attachment` | `projectId` (`Cascade`), `folderId` (null = root, `SetNull`), `attachmentId` (unique, `Cascade`), `name`, `extractedText` (server-side text extraction for retrieval), `tag` (auto-classified content type), `indexedAt` |
| `AiProjectChunk` | A retrieval chunk of a project file | `fileId` (`Cascade`), `projectId` (denormalised for project-scoped filtering), `ord`, `text` |

Sable's *actions* are not stored as models — its write operations are RBAC-gated proposals defined
in code (`lib/ai-operations/*`) and applied through the normal server actions, which write their
own `AuditLog` rows. See [ai.md](./ai.md).

### Operations & planning (freeze, on-call, status, releases, contracts, insights)

Added by migration `20261107000000_itsm_ops_sable` (the history also has `20261105000000_itsm_lifecycle_links`, `20261105120000_ticket_parent_merge_history` and `20261106000000_sable_skills_mcp_proposal_decisions`; see Migration workflow). Ids are `cuid` strings unless noted. Enum-like columns are
`String`s validated against the tuples in [`lib/constants.ts`](../lib/constants.ts) (see the enum table below).

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `ChangeFreezeWindow` | A period in which changes may not be submitted or rescheduled | `name`, `reason`, `startsAt`/`endsAt`, optional `serviceId` and `groupId` (both `Cascade`). Global when both scopes are null; otherwise applies only when **every set scope** matches the change. Indexed `(startsAt, endsAt)`; creator/editor is recorded through the audit log, not a column |
| `OnCallSchedule` | A rotation for one team | `name`, `groupId` (`Cascade`), `timezone` (IANA), `rotationType` (`ONCALL_ROTATION_TYPES`), `customIntervalHours` (only for `CUSTOM`), `handoffTime` (`HH:mm` local), `rotationStart` (first handoff, UTC), `isActive`; has `members`, `overrides` |
| `OnCallMember` | A user in a rotation | `scheduleId`, `userId` (`Cascade`), `position` (0 = first); unique `(scheduleId, userId)` |
| `OnCallOverride` | A swap or cover that always beats the rotation | `scheduleId`, `userId` (who is on call), `replacesUserId` (`SetNull`), `startsAt`/`endsAt`, `reason` |
| `StatusIncident` | A public-facing status incident | `title`, `summary` (public text), `state` (`STATUS_INCIDENT_STATES`), `impact` (`STATUS_INCIDENT_IMPACTS`), `isPublic` (default `false` = draft), `ticketId` (**unique**, `SetNull`: one incident per ticket, which makes creation from a major incident idempotent), `startedAt`, `publishedAt`, `resolvedAt`; has `services`, `updates` |
| `StatusIncidentService` | Services affected by an incident | composite id `(incidentId, serviceId)`, both `Cascade` |
| `StatusIncidentUpdate` | One timeline post | `incidentId` (`Cascade`), `state`, `body`, `authorId` (`SetNull`); public exactly when its incident is |
| `Release` | A bundle of changes deployed together | `id` (**Int** → `REL-0001`), `name`, `status` (`RELEASE_STATUSES`), `ownerId`, `groupId` (`SetNull`), `deployedAt`; has `changes`. The release window is derived from the changes' planned windows and never stored |
| `ChangeTemplate` | A reusable change (standard or normal) | `name` (unique), `summary`, `isActive`, `type` (`CHANGE_TEMPLATE_TYPES`), `title`, `description`, `reason`, `implementationPlan`, `rollbackPlan`, `risk`, `priority`, `impact`, `categoryId`/`serviceId`/`groupId` (`SetNull`); `Change.templateId` records which template a change came from |
| `Vendor` | Supplier of contracts and licenses | `name` (unique), `website`, `email`, `phone`, `notes`, `isActive` |
| `Contract` | A support, lease, subscription… agreement | `name`, `number`, `type` (`CONTRACT_TYPES`), `status` (`CONTRACT_STATUSES`), `vendorId`, `ownerId` (reminder recipient), `startDate`/`endDate`, `cost`, `renewalNoticeDays` (default 30), `autoRenew`, `renewalNotifiedFor` (the `endDate` the reminder fired for, so moving `endDate` re-arms it) |
| `ContractAsset` | Assets covered by a contract | composite id `(contractId, assetId)`, both `Cascade` |
| `SoftwareLicense` | A license pool | `name`, `vendorId`, `contractId`, `ownerId`, `licenseType` (`LICENSE_TYPES`), `seats`, `expiresAt`, `cost`, `overAllocatedNotifiedAt` (at-most-once alert marker, cleared when compliant again) |
| `LicenseAssignment` | A used seat | `licenseId` (`Cascade`), `userId` and/or `assetId` (`Cascade`), `assignedAt`. At least one target must be set and duplicates are rejected in the action (NULLs defeat a DB unique); used seats = number of rows |
| `AiInsight` | A pattern Sable detected | `kind` (`AI_INSIGHT_KINDS`), `status` (`AI_INSIGHT_STATUSES`), `dedupeKey` (**unique**, at-most-once creation), `title`, `summary`, `payload` (JSON as TEXT), `problemId`/`articleId` (`SetNull`: what was created from it), `dismissedById`/`dismissedAt` |
| `AiInsightTicket` | Tickets behind an insight | composite id `(insightId, ticketId)`, both `Cascade` |

New columns on existing models: `Ticket.slaNudgedAt` (at-most-once SLA nudge marker), `Change.releaseId`
(`SetNull`), `Change.templateId` (`SetNull`) and an index on `Change(plannedStart, plannedEnd)` for calendar and
conflict queries. `EscalationStep.action` gained `NOTIFY_ONCALL` and `REASSIGN_ONCALL` (no new column: the target is
the current on-call of the ticket's team). A change has no service column; its services are those of its affected CIs
(`ChangeAsset` → `ServiceAsset`).

At-most-once markers in this group: `Ticket.slaNudgedAt`, `Contract.renewalNotifiedFor`,
`SoftwareLicense.overAllocatedNotifiedAt`, `AiInsight.dedupeKey`, `StatusIncident.ticketId`.

### Maintenance windows

Added by migration `20261108000000_maintenance_windows`. Enum-like columns are `String`s validated against `lib/constants.ts`.

| Model | Purpose | Key fields / relations |
| --- | --- | --- |
| `MaintenanceWindow` | A planned period for an update or general maintenance | `title`, `message` (shown to users), `kind` (`MAINTENANCE_KINDS`), `status` (`MAINTENANCE_STATUSES`), `startsAt`/`endsAt` (planned; a general window ends at `endsAt`), `announceHours` (banners from `startsAt − announceHours`, default 24), `blockAccess` (maintenance mode for non-admins while `IN_PROGRESS`, default `true`), `targetVersion`/`fromVersion` (update windows), `startedAt`/`finishedAt`, `result` (last updater message or failure reason), `log` (JSON array copied from the updater's `status.json`), `createdById` (`SetNull`). Indexed `(status, startsAt)` |

Transitions are claimed with a conditional `updateMany` (`status` must still be the expected one), so overlapping ticks, or a tick in the old and the new container during an update, never both act. The update-check result lives in `AppSetting` rows `UPDATE_CACHE` and `UPDATE_NOTIFIED_VERSION` (at-most-once marker per announced version), not in a table of its own.

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
| `ESCALATION_ACTIONS` | `EscalationStep.action` | `NOTIFY`, `REASSIGN`, `BUMP_PRIORITY`, `NOTIFY_ONCALL`, `REASSIGN_ONCALL` |
| `APPROVAL_STATUSES` | `TicketApproval.status`, `ChangeApproval.status`, `Approval.status`, `Ticket.approvalState` | `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED` |
| `APPROVAL_ENTITY_TYPES` | `Approval.entityType` | `TICKET`, `PROBLEM`, `CHANGE`, `SERVICE` |
| `SERVICE_STATUSES` | `Service.status` | `OPERATIONAL`, `DEGRADED`, `OUTAGE`, `MAINTENANCE`, `RETIRED` |
| `CRITICALITIES` | `Service.criticality` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| `AUTO_ASSIGN_STRATEGIES` | `Group.autoAssign` | `OFF`, `ROUND_ROBIN`, `LEAST_BUSY` |
| `GROUP_TYPES` | `Group.type` | `TEAM`, `DEPARTMENT`, `VENDOR` |
| `GROUP_MEMBER_ROLES` | `GroupMember.role` | `MEMBER`, `LEAD` |
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
| `ONCALL_ROTATION_TYPES` | `OnCallSchedule.rotationType` | `DAILY`, `WEEKLY`, `CUSTOM` |
| `STATUS_INCIDENT_STATES` | `StatusIncident.state`, `StatusIncidentUpdate.state` | `INVESTIGATING`, `IDENTIFIED`, `MONITORING`, `RESOLVED` |
| `ACTIVE_STATUS_INCIDENT_STATES` | (subset) | `INVESTIGATING`, `IDENTIFIED`, `MONITORING` |
| `STATUS_INCIDENT_IMPACTS` | `StatusIncident.impact` | `NONE`, `MINOR`, `MAJOR`, `CRITICAL` |
| `RELEASE_STATUSES` | `Release.status` | `PLANNING`, `READY`, `IN_PROGRESS`, `DEPLOYED`, `CANCELLED` |
| `CHANGE_TEMPLATE_TYPES` | `ChangeTemplate.type` | `STANDARD`, `NORMAL` |
| `CONTRACT_TYPES` | `Contract.type` | `SUPPORT`, `MAINTENANCE`, `LEASE`, `SUBSCRIPTION`, `WARRANTY`, `SERVICE`, `OTHER` |
| `CONTRACT_STATUSES` | `Contract.status` | `DRAFT`, `ACTIVE`, `EXPIRED`, `TERMINATED` |
| `LICENSE_TYPES` | `SoftwareLicense.licenseType` | `PER_USER`, `PER_DEVICE`, `SITE`, `CONCURRENT`, `SUBSCRIPTION` |
| `AI_SCOPES` | `AiConversation.scope` | `GENERAL`, `ADMIN` |
| `AI_MCP_TRANSPORTS` | `AiMcpServer.transport` | `http`, `sse` |
| `AI_MCP_MODES` | `AiMcpServer.mode` | `READ_ONLY`, `APPROVAL`, `TRUSTED` |
| `AI_INSIGHT_KINDS` | `AiInsight.kind` | `CLUSTER`, `KB_GAP` |
| `AI_INSIGHT_STATUSES` | `AiInsight.status` | `OPEN`, `ACTIONED`, `DISMISSED` |
| `MAINTENANCE_KINDS` | `MaintenanceWindow.kind` | `GENERAL`, `UPDATE` |
| `MAINTENANCE_STATUSES` | `MaintenanceWindow.status` | `SCHEDULED`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `ROLLED_BACK`, `CANCELLED` |
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
[`prisma/seed.ts`](../prisma/seed.ts) (users, groups, categories, SLAs, services, assets and relations, tickets,
problems, changes, articles, a sync source, an API token, audit entries, notifications) and
[`prisma/seed-extras.ts`](../prisma/seed-extras.ts) (locations, catalog items, automation rules, business
calendars and escalation policies, macros, change templates, an on-call schedule, a release, vendors, contracts and
licenses); `package.json` runs both via the `prisma.seed` hook (`tsx prisma/seed.ts && tsx prisma/seed-extras.ts`).

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

### Migration history

The history starts from a **squashed baseline** (`20260823000000_init_baseline`) that
creates the schema as it stood then — the original incremental migrations had drifted
far behind the schema (23 models were never migrated, which broke `pnpm setup`/`db:reset`)
and were collapsed. Regular incremental migrations follow it:

| Migration | Adds |
| --- | --- |
| `20261105000000_itsm_lifecycle_links` | `ServiceAsset`, `ArticleLink` |
| `20261105120000_ticket_parent_merge_history` | `Ticket.parentId`, `TicketMerge` |
| `20261106000000_sable_skills_mcp_proposal_decisions` | `AiSkill`, `AiMcpServer`, `AiProposalDecision` |
| `20261107000000_itsm_ops_sable` | the Operations & planning models (freeze windows, on-call, status page, releases, change templates, vendors/contracts/licenses, Sable insights) |
| `20261108000000_maintenance_windows` | `MaintenanceWindow` |
| `20261109000000_widen_int_overflow_columns` | `Ticket.pausedMs` and `Attachment.size` as `Float` (`REAL`) |
| `20261112100000_attachment_targets` | `Attachment.changeId`/`problemId`/`assetId`/`licenseId` (table rebuilt: SQLite cannot add foreign keys in place) |

At the time of writing, `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma`
(with a shadow database) reports no difference, i.e. the migrations reproduce the current schema. Local
development can also use `pnpm db:push`, while `pnpm setup` (migrate deploy +
seed) works on any fresh database. The provider lock is `sqlite`
([`prisma/migrations/migration_lock.toml`](../prisma/migrations/migration_lock.toml)); switching to Postgres
for production means changing both the `datasource` provider and this lock, then regenerating the migration
history for the new engine.
