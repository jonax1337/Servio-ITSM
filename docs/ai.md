# 🤖 Sable — the built-in AI agent

**Sable** is Servio's built-in AI service-desk agent. Unlike a bolt-on chatbot, Sable is wired into
the platform's data and its RBAC: it can read your queue, search across the app and the web, and
**propose concrete changes that you approve with one click** before anything is written.

Sable is **optional and off by default**, **self-hostable** (runs fully local against Ollama), and
**privacy-first** (a hard gate blocks any external provider unless you explicitly opt in). All AI
runs server-side — provider keys never reach the browser.

> **Naming.** The display name lives in one place — `AI_ASSISTANT_NAME` in `lib/constants.ts`
> (currently `"Sable"`). Code identifiers, filenames and the ticket source enum all use the matching
> `sable`/`Sable`/`SABLE` handle (`sable-*`, `Sable*`, `SOURCE_META.SABLE`); the chat route is
> `/api/assistant`. Change `AI_ASSISTANT_NAME` to relabel the assistant everywhere.

See also: [configuration.md](configuration.md#ai-service-agent-sable) for the environment/settings
reference, and [architecture.md](architecture.md) for the runtime model.

---

## Where Sable lives

There is exactly **one** Sable window in the console. It is mounted once — in
`app/(console)/layout.tsx` via `<SableProvider>` + `<SableMount>` — so the window (and its active
conversation and in-flight stream) survive client-side navigation.

| Surface | Location | Audience |
| --- | --- | --- |
| Global floating window | `<SableMount>` (`components/assistant/sable-mount.tsx`) → the `<SableWindow>` overlay | Agents+ |
| Floating action button | `SableFab` (`components/assistant/{sable-fab,sable-chrome}.tsx`), bottom-right | Agents+ |
| Inline route | `app/(console)/assistant/` → route `/assistant` (the same window, `variant="inline"`) | Agents+ |

- **The window is a small state machine** (`components/assistant/sable-provider.tsx`): `closed` → nothing
  but the FAB; `min` → a small floating chat card; `max` → a large centered window that adds the
  conversation-history rail. `min` and `max` render the **same** conversation, so
  expanding/minimising never loses context.
- **The FAB is the entry point.** The old top-bar launcher is gone; the always-present `SableFab`
  restores whatever state (min/max) Sable was last left in, with the last conversation reopened.
- **`/assistant` renders the same window inline** (docked, full-page, no overlay) so the surface stays
  deep-linkable while sharing the one `<SableProvider>` state. There is no separate standalone shell.

Ticket context is picked up automatically: on a `/tickets/:id` page the provider passes
`{ ticketId }` so "this ticket"/"summarise it" resolve without typing the ref (a "Sable" link can
also set an explicit context override).

Access requires the **AGENT** role — re-asserted in `app/(console)/assistant/page.tsx` and again
server-side in every route/action.

### Scopes

| Scope | Who sees it | What it's for |
| --- | --- | --- |
| **General** | All agents | Day-to-day service-desk work: your queue, tickets, KB, records. |
| **Admin** | Admins only (extra tab) | System-wide stats, settings, and management operations. |

There is **no scope switch in the UI** — the old General/Admin rail toggle was removed. Admin
operations (system-wide stats, settings, management ops) surface in the normal chat and are gated
**per-operation by the acting user's role** (`minRole` / `adminOnly` = ADMIN, checked against the
fresh DB role at propose AND apply time). Legacy conversations may still carry `scope=ADMIN` in the
database; the column no longer gates anything.

---

## The chat engine (assistant-ui)

Sable's chat UI is built on **[assistant-ui](https://www.assistant-ui.com/)** — the packages
`@assistant-ui/react` + `@assistant-ui/react-ai-sdk`, over AI SDK v7 (`@ai-sdk/react`).

- The scaffolded base-ui thread is `components/thread.tsx`, with its supporting parts
  `components/{markdown-text,reasoning,tool-fallback,tool-group,tooltip-icon-button,attachment,follow-up-suggestions}.tsx`.
- `components/assistant/sable-thread.tsx` wires a `useChatRuntime(AssistantChatTransport)` to the
  streaming route and renders the `Thread`. It **hydrates history** from the DB (`getConversation`),
  and creates the conversation **lazily on the first send** (`createConversation`) — so an empty
  "New chat" never hits the DB or the rail until you actually chat.
- `components/assistant/sable-tool-ui.tsx` is the thread's `ToolFallback`: it renders read-tool
  activity via the default `ToolFallback`, and for `propose_*` write tools it renders the
  approve-first `ProposalCard` (the proposal arrives as the tool's **result**). Approve/dismiss is
  recorded server-side per proposal (`AiProposalDecision`), so a reloaded chat shows each card as
  pending, applied or gone.

`components/assistant/sable-window.tsx` frames the thread (header + the max-state rail) and keeps a
single `<SableThread>` mounted across the min↔max morph so an in-flight stream is never lost.

---

## The streaming route

Chat runs through **`app/api/assistant/chat/route.ts`** (`POST`, AGENT+). It is
**server-authoritative**: assistant-ui/`useChat` posts the full `messages[]` array, but the route
ignores that history and **rebuilds context from the DB**, then streams the reply.

**Answers outlive the request.** The agent run has its own abort controller and is pumped into an
in-memory registry (`lib/sable-active-runs.ts`; one self-hosted process, so no Redis). The run is
reserved (`beginRun`, after a cheap owner check) **before** the question is saved and gets its
stream later, so whoever sees the question can always rejoin or stop its answer. One answer per
conversation at a time: a second POST while one runs gets `409`. The POST response is just one
subscriber: leaving the chat, closing the window or reloading only drops it.
`getConversation` reports `resumable` while the last stored message is the user's and a run is
registered; the thread then calls `resumeStream()`, and
**`app/api/assistant/chat/[id]/stream/route.ts`** `GET` replays everything streamed so far and
follows live (204 when nothing runs; a finished run stays replayable for 60 s). The Stop button
(and Escape in the composer) calls `DELETE` on the same route, which aborts the run; `pipeAgentRun` stops recording at that
moment, so the saved partial answer is what the user saw. Runs are per user: another user's run is
neither visible nor stoppable. Deleting a conversation stops its run, and a run nobody stops ends
after 15 minutes. The portal chat keeps the request-bound behaviour.

The pre-model logic is shared, non-`"use server"` code in **`lib/assistant-core.ts`**:

- `getActingAgent()` — the acting user with a **fresh** role from the DB (never the stale JWT).
- `prepareAssistantTurn()` — authorise the conversation + scope, persist the user turn, auto-title
  from the first message, load bounded history (last 16 turns), and assemble system + messages +
  tools. Returns everything up to (but not including) the model call.
- `buildUserContent()` / `sanitizeUploads()` — turn uploads into multimodal model content
  (images → image parts, text files inlined, PDFs → file parts) with a text-only fallback.
- `generalSystemPrompt` / `adminSystemPrompt` — the per-scope system prompts.
- `buildAssistantProposals()` — turn `propose_*` tool calls into deduped approval cards.

Streaming itself — **one agent harness for every provider**:

- Every turn runs through the locally installed **Claude Code** CLI via the Claude Agent SDK
  (`lib/claude-cli.ts`, `streamClaudeAgent`). Sable's ai-sdk tools are adapted 1:1 into an
  in-process MCP server, so tool handlers keep direct DB access. All built-in Claude Code tools are
  disabled (`tools: []`), project settings are not loaded, and sessions are not persisted to disk.
- `lib/claude-agent-events.ts` maps the SDK's partial stream events to ai-sdk UI chunks **live**:
  thinking → `reasoning-*`, each tool call → `tool-input-start/delta/available` while the model writes
  it, each tool result → `tool-output-available`, and the text between steps → `text-*`. The chat
  therefore shows the agentic loop step by step (reasoning and tool groups stay open while running).
- `propose_*` tools return their proposal as the tool result, so approval cards appear inline the
  moment the agent proposes. Staged upload ids are injected into `ticket.create`/`ticket.comment`
  proposals **before** the tool runs (server-controlled — any model-supplied `attachmentIds` is
  stripped).
- When the run ends, the route emits the `cited_sources` part and the `proposals` metadata and
  persists the assistant turn. A failure mid-run becomes a final `⚠️` text part.

`lib/ai.ts` exposes `streamAiChat` (live chunks) next to `generateAiText` / `generateAiObject`,
which run the same harness to completion.

> **Server actions.** `lib/actions/ai-assistant.ts` keeps the conversation/folder CRUD and
> `applyAssistantProposal` / `dismissAssistantProposal` (below); chat turns only go through the
> streaming route.

---

## What Sable can do

Sable's capabilities split cleanly into **read tools** (run immediately) and **write operations**
(propose-only — see [the approve-first flow](#the-approve-first-flow)).

### Read & research tools

General scope (`lib/assistant-tools.ts` + `lib/ai-tools.ts`):

- `list_my_tickets` — the signed-in agent's personal queue (active first).
- `list_team_tickets` — the agent's team backlog (e.g. unassigned work to pick up).
- `list_tickets` — structured filters (assignee / status / priority / team).
- `get_ticket` — full detail of one ticket: SLA due dates & breaches, impact/urgency, comments.
- `search_tickets`, `search_problems`, `search_changes` — free-text search.
- `search_knowledge_base` — KB articles (`knowledgeSearchTool`, `lib/ai-tools.ts`). **Trust boundary:**
  it filters on `status: "PUBLISHED"` only — **no `visibility` filter** — so it returns **INTERNAL**
  articles as well as public ones. This is safe *only* because the tool is **AGENT-only** (console
  Sable). It must **never** be reused in the USER/portal context; the portal has its own
  `search_knowledge` (`portalKnowledgeTool`, `lib/portal-assistant.ts`) that additionally filters
  `visibility: "PUBLIC"`. Do not swap one for the other.
- `category_list`, `group_list` — the **real** category / team names, so the model sets an existing
  one instead of inventing a `Parent > Child` path (`resolveCategoryId` also tolerates that path by
  falling back to the leaf name; a "not found" reply suggests the closest matches).
- `web_search`, `fetch_url` — public web + read a URL, for facts not documented in-house.
  `web_search` uses a real provider API when configured — **Tavily** or **Brave** (clean,
  LLM-friendly results) — else the keyless DuckDuckGo scraper (`lib/ai-tools.ts` `webSearch`; set
  `WEB_SEARCH_PROVIDER` + the key in Settings → AI). `fetch_url` strips page chrome before reading.
- `draft_document` — hand a long free-standing document (runbook, RCA, KB draft) or **script** to the read-only **canvas**; never used for a record the user asked to create, whose content goes into the `propose_*` fields (see
  [Artifacts & the canvas](#artifacts--the-canvas)).

A turn's thinking and read-tool calls render as **one chain** (`AgentChain` in `components/thread.tsx`):
a single "N steps" disclosure, open while Sable works, with a node per thought or tool chip on a
vertical line. Approval cards and drafted documents stay outside it. In answers, record states written
as namespaced inline code (`` `status:OPEN` ``, `` `priority:HIGH` ``, `` `change:SCHEDULED` ``) render
as the list's tone badges, and record refs as inline code (`` `INC-0142` ``, `` `CHG-0039` ``) as links
(`lib/inline-badge.ts`).

The web pages, KB articles and project files a turn grounded on are aggregated into a **"Sources"**
row rendered under the answer (a synthetic `cited_sources` part emitted after the run;
`SableSourcesCard`). Source URL schemes are validated (only `http(s)` / in-app relative paths).

Admin scope adds (`lib/ai-admin-tools.ts`, `lib/ai-stats.ts`):

- `get_statistics` — live metrics: tickets by status/priority/team/category, open counts,
  created/resolved over a timeframe, SLA breaches, users by role, a counts overview.
- `get_settings_overview` — non-secret settings and whether each secret is set (never the value).
- `search_people`, `search_groups`, `search_categories`, `search_services` — record lookups.

Identity is always captured server-side (the acting agent's id and team memberships) — the model
can never spoof "who am I". AI-authored bodies (comments, descriptions) are rendered from markdown to
sanitised HTML (`lib/ai-operations/helpers.ts` `richHtml`) so paragraphs/lists/line breaks survive.

### Write operations (RBAC-gated, propose-only)

Every mutation Sable can suggest is defined as an `AiOperation` in `lib/ai-operations/` and surfaced
to the model as a `propose_*` tool (`lib/ai-operations/tools.ts` builds these from the registry).
Coverage by module:

| Module | File | Operations (write) |
| --- | --- | --- |
| Tickets | `modules/tickets.ts` | create, update field/status/priority/type, comment, resolve, escalate, link/unlink (`ticket.unlink`), parent/child (`ticket.set_parent`), merge / undo merge (`ticket.merge`, `ticket.unmerge`), tasks, work-log, watch, major-incident |
| Categories | `modules/taxonomy.ts` | category create/update |
| Groups & Users | `modules/org.ts` | group create / auto-assign, user field (role/active — ADMIN) |
| Services & Catalog | `modules/catalog-services.ts` | service create/update, catalog item create/publish/delete |
| Assets & Locations (CMDB) | `modules/cmdb.ts` | asset create/update, `asset.link_ticket` / `asset.unlink_ticket`, location create/update/delete |
| Knowledge base | `modules/knowledge.ts` | article create, set status, delete; `article.link` / `article.unlink` (attach to a ticket, problem or change by ref) |
| Problems & Changes | `modules/problems-changes.ts` | problem/change create (`change.create` takes the full record: reason, implementation/rollback plan, planned window, problem link), update field, comment; `change.set_plan` / `change.set_window`; `change.set_problem`, `change.close` (outcome + closure notes), `change.cancel` (reason); `problem.set_root_cause` / `problem.set_workaround` (a known error needs a workaround, a resolved problem a root cause, closed problems are read-only — the same gates as the UI, from `lib/problem-rules.ts`); `ticket.set_problem` / `ticket.set_change` (link or unlink); reads `problem.get` / `change.get` |
| SLAs, Automations, Settings | `modules/config.ts` | SLA CRUD, automation toggle/delete, setting update (ADMIN) |
| Change schedule | `modules/change-schedule.ts` | `change.schedule` (read, AGENT: windows, conflicts and freezes for a period), `freeze.create` (write, MANAGER) |
| On-call | `modules/oncall.ts` | `oncall.who` (read, AGENT), `oncall.override` (write, MANAGER) |
| Status page | `modules/status.ts` | `status_incident.list` (read, AGENT), `status_incident.create` / `.update` / `.post_update` (write, AGENT; publishing needs MANAGER, checked inside `run`, and the ops reuse the shared actions so the ticket-link checks apply) |
| Releases & templates | `modules/releases.ts` | `release.create`, `release.add_change`, `change.create_from_template` (write, AGENT), `change_template.list` (read, AGENT) |
| Contracts & licenses | `modules/contracts.ts` | `contract.expiring`, `license.compliance` (read, AGENT), `contract.create` (write, MANAGER; owner defaults to the acting user) |
| Insights | `modules/insights.ts` | `ticket.find_similar`, `insight.list` (read, AGENT), `insight.problem_from_cluster` (write, AGENT) |
| Integrations | `modules/mcp.ts` | `mcp.call` — run a tool on a remote MCP server; never a model tool: the harness creates the proposal for `APPROVAL`-mode servers, and approving re-checks the server's config and the approver's role (see [Remote MCP servers](#remote-mcp-servers-libsable-mcpts-libsable-mcp-policyts)) |

**Read operations are tools too.** An `AiOperation` with `kind: "read"` is turned into a model tool by `buildOperationTools` (tool name = id with dots replaced by underscores, e.g. `oncall_who`) and runs immediately; a `kind: "write"` operation becomes `propose_<id>` and goes through the approve-first flow. A module therefore adds read tools just by listing them in its `OPERATIONS`, with no change to `tools.ts`.

**Insights, similarity and copilots.** `lib/ai-similarity.ts` ranks tickets with local lexical TF-IDF, so `ticket.find_similar` and the "similar tickets" panel need no AI provider. The `lib/ticks/ai-insights.ts` tick (`runInsightsTick`) raises `AiInsight` rows (`CLUSTER`: a burst of similar tickets, `KB_GAP`: recurring tickets without an article); each is created at most once through the unique `dedupeKey`, and agents act on them from `/insights` (create a problem, draft an article, dismiss). Draft articles use `generateAiObject` when AI is configured and a plain skeleton otherwise. The other AI surfaces are agent-only buttons that call `lib/ai.ts` through server actions and render nothing for non-agents: the ticket summary card (`components/ai/ticket-summary-card.tsx`), the change plan copilot and CAB brief (`lib/actions/change-copilot.ts`, `lib/change-brief.ts`; the copilot writes only through `updateChangeText`) and the dashboard `briefing` widget (`lib/dashboard/briefing*.ts`). When AI is off they show the teaser, like the rest of Sable.

**Proactive SLA nudges.** `lib/ticks/sla-nudges.ts` (`runSlaNudgeTick`, rules in `lib/sla-nudge-rules.ts`) notifies a ticket's assignee (notification type `SLA_NUDGE`) once when the SLA clock passes `SLA_NUDGE_PERCENT`. The marker is `Ticket.slaNudgedAt`; it is independent of the escalation sweep and of `slaAtRiskNotifiedAt`.

**Ticket to problem/change links.** `ticket.set_problem` and `ticket.set_change` (both `minRole` AGENT) take a
ticket ref (`INC-0157`) and a `PRB-0019` / `CHG-0025` ref, or `none` to unlink. They reuse `setTicketProblem` /
`setTicketChange`, the actions the ticket page uses, so the link appears in the UI exactly as if an agent had set it.
The ops then read `Ticket.problemId` / `changeId` back and return `err(...)` when the action silently refused (role,
missing target). A ref of the wrong kind (a `CHG-` ref for a problem) is rejected by `parseRecordNumber`
(`helpers.ts`). A change's own problem link is set with `change.set_problem` (`setChangeProblem`), same ref/`none` convention.

**Parent/child and merge.** `ticket.set_parent` (child ref + parent ref, or `none` to detach), `ticket.merge` (duplicate ref + the ticket that stays) and `ticket.unmerge` (the merged ticket's ref) call `setTicketParent`, `mergeTicket` and `unmergeTicket`, so every rule the UI enforces (no cycles, no closed/cancelled/merged parent, merged tickets only move back via undo) applies and the refusal reason reaches the user. The approval card for a merge lists what is copied (comments, watchers, linked assets, ticket links) and what is moved (attachments, child tickets), that the target adopts the source's problem/change when it has none, that pending approvals are withdrawn, that the source is cancelled and that the merge can be undone. `mergeTicket` redirects on success; the op swallows that `NEXT_REDIRECT` and reads `mergedIntoId` back. `ticket.update_field` and `ticket.resolve` return the action's own refusal reason (for example the merged-ticket status guard) instead of the generic one. `ticket.set_parent` reports "already a child of" / "has no parent" when nothing would change. The `get_ticket` read tool and the ticket-scoped chat context (`loadTicketContext` in `lib/actions/ai.ts`) both carry parent and merge facts; `get_ticket` returns `parent`, `children` (first 10) with `childCount`, `mergedInto` and `mergedTicketCount` (shaped by `ticketRelations` in `ticket-relations.ts`).

**Refused writes.** The field-update and status ops read the record back after the action runs (`verifyFieldWrite` in `helpers.ts`) and return an error when the write was refused (workflow rule, role, or a request awaiting approval — which can only be cancelled) instead of claiming success.

**Reading one problem or change.** The read ops `problem.get` and `change.get` (tools `problem_get`, `change_get`)
return a compact record. A problem: status, priority, impact, root cause, workaround, team, assignee, description,
linked tickets and changes, latest comments. A change: type, risk, priority, impact, status, planned and actual
start/end, reason, implementation plan, rollback plan (`not recorded` when empty), the CAB approval rule with each
approver's decision and comment, linked problem and tickets, assignee, team, latest comments. Long text is clipped
(`clip`). The schema has no test-plan field, so none is returned. `search_problems` / `search_changes` remain the
keyword search.

Authority is **the app's real RBAC**. Each operation's `minRole` mirrors the underlying UI
action, so Sable can do exactly what the acting user could do by hand — no more. Operations flagged
`adminOnly` require the **ADMIN role _and_ an ADMIN-scoped conversation** (defence in depth).
`setting.update` refuses any key that looks secret (contains `KEY`/`PASS`/`SECRET`/`TOKEN`) **and
hard-refuses the self-locked privacy keys `AI_ALLOW_EXTERNAL` / `AI_PROVIDER`** so a prompt-injection
can never steer an admin into opening the off-box data path — change those in the Settings UI only.
When the underlying server action fails, ops like `ticket.escalate` / `ticket.watch` propagate its
`{ ok: false, error }` result back to the model as `err(...)` instead of always reporting success.

> **`adminOnly` ops are gated by role AND scope.** `availableOperations` / `runOperation`
> (`lib/ai-operations/tools.ts`) filter and re-check `adminOnly` operations against **both**
> `hasRole(role, 'ADMIN')` **and** `scope === 'ADMIN'` — at propose time and again at approve time.
> An ADMIN chatting in the General scope is **not** offered system-wide config ops; they must switch
> to the Admin scope. Non-`adminOnly` operations are still gated purely by `minRole`. (Historical note:
> the `scope` argument used to be plumbed through unused — it is now enforced.)

---

## The approve-first flow

Nothing Sable "decides" to change is applied automatically. The path is:

1. **Propose.** The model calls a `propose_*` tool. The tool validates the arguments against the
   operation's Zod schema and returns the full *proposal as the tool result* — **no mutation
   happens**.
2. **Render.** assistant-ui renders that tool part through Sable's tool UI
   (`components/assistant/sable-tool-ui.tsx`), which shows an **approval card**
   (`components/assistant/proposal-card.tsx`) with **Approve** and **Dismiss** buttons. (Proposals
   are also collected into message metadata and persisted, so the cards survive a re-hydrate.)
3. **Approve.** Clicking Approve calls the `applyAssistantProposal` server action, which
   **re-resolves the operation, re-checks RBAC** (fresh DB role vs. `minRole`; `adminOnly` ops
   additionally require the ADMIN role), **re-validates the args** (via `runOperation`), then runs
   the real mutation —
   reusing existing server actions where possible, else a guarded Prisma write plus an audit entry.

Client-supplied args are never trusted: they are re-validated at apply time. The underlying
mutation writes its own audit trail, so AI-driven changes are indistinguishable from — and as
accountable as — manual ones. Each decision is recorded in
`AiProposalDecision` (`lib/ai-proposal-decisions.ts`), keyed by the tool call that made the
proposal plus a signature of its operation and parsed args. Approve first **claims** that key (a
unique row, with a token), so a proposal is applied at most once across double clicks, tabs and
reloads; re-approving an applied one returns its original result. An apply whose result was never
recorded stays claimed and shows as unconfirmed rather than offering Approve again. When the client
sends the id of a stored proposal, the server applies the stored args, not the client's; other args
are still re-validated and re-checked against the role. Asking for the same change again later is a
new tool call and therefore a new proposal (the canvas "Save as KB article" mints one per draft). Proposals stored before decisions were
recorded (no `decisionTracked` / `toolCallId`) are not offered again on reload.

Content-heavy proposals (a KB-article body, a long comment/description) get a **"Preview"** on the
card that opens the full body read-only in the canvas.

---

## Artifacts & the canvas

When Sable drafts something longer than a chat reply — a runbook, RCA, change doc, KB article, or a
**script/file** — it calls `draft_document`, which opens a **read-only artifact canvas** beside the
chat (Claude-style), never an editable field:

- **Code/scripts** render syntax-highlighted with line numbers (`components/assistant/canvas-code.tsx`,
  full `react-shiki` WASM engine so every language highlights) and a language badge; **prose** renders
  as clean markdown.
- Actions: **Copy**, **Download** (the file), **Insert into chat**, **Save to project** (a picker —
  writes the artifact as a real project file via `saveArtifactToProject`), and for prose **Save as KB
  article** (through the same approve-first proposal path).
- To change an artifact the user asks Sable, which re-drafts it.

Files: `components/assistant/sable-canvas.tsx` (+ `sable-provider` `canvasDoc`/`openCanvas`),
`lib/assistant-tools.ts` (`draft_document`).

---

## Projects (persistent workspaces)

Sable conversations can live inside a **Project** — a persistent, optionally **team-shared**
workspace with its own **files/folders** (an internal knowledge base), **instructions**, and
optional binding to a Change / Problem / Ticket. A project-bound chat injects the project's
instructions + file list and can retrieve from its files (`project_search_files`). Uploaded files are
extracted + indexed for retrieval and auto-tagged; office documents preview at high fidelity when a
[Gotenberg service](deployment.md#-docker) is configured.

- Schema: `AiProject` / `AiProjectFolder` / `AiProjectFile` / `AiProjectChunk`; `AiConversation.projectId`.
- Access: `lib/ai-projects.ts` (`loadAccessibleProject` — owner or shared-group member); CRUD in
  `lib/actions/ai-assistant.ts` + `lib/actions/ai-project-files.ts`.
- UI: the rail's **Projects** section → a project **overview** (files + linked records + a real
  composer). See [modules.md](modules.md) for the file map.

---

## Providers

Configured via `AI_PROVIDER` (`lib/ai.ts`). Config resolves through `lib/settings` — a DB
`AppSetting` row overrides `process.env` — so an admin can manage everything from the UI.

**Every provider runs through the local Claude Code CLI** (the `claude` binary must be installed on
the server). The provider only decides which endpoint Claude Code talks to (`openClaudeBackend()`):

| Provider | `AI_PROVIDER` | Claude Code talks to | Key | Privacy gate | Default model |
| --- | --- | --- | --- | --- | --- |
| **Ollama** | `ollama` | built-in proxy → `OLLAMA_BASE_URL` (**local, on-box**) | none | not gated (self-authorized) | `OLLAMA_MODEL` (`llama3.1`) |
| **Anthropic** | `anthropic` | Anthropic API | `ANTHROPIC_API_KEY` | **requires `AI_ALLOW_EXTERNAL=true`** | `claude-sonnet-5` |
| **OpenAI-compatible** | `openai` | built-in proxy → `OPENAI_BASE_URL` | `OPENAI_API_KEY` | **requires `AI_ALLOW_EXTERNAL=true`** | `gpt-4o` |
| **Claude subscription** | `claude-code` | Anthropic, via your Pro/Max plan | `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`) | not gated (self-authorized) | `sonnet` |

- **Ollama** is a local, OpenAI-compatible endpoint — no key, data stays on the machine. This is
  the privacy-safe default and the recommended way to try Sable.
- **OpenAI-compatible** works with any compatible cloud via `OPENAI_BASE_URL` (OpenAI, OpenRouter,
  Moonshot/Kimi, Zhipu/GLM, …); the model id comes from `AI_MODEL`.
- **Claude subscription** (`claude-code`) uses the operator's Pro/Max plan. Because Sable runs in
  its own isolated Claude Code instance (below), it cannot reuse an interactive `claude` login. The
  **Connect Claude** dialog on Settings › Sable walks the admin through it: run
  `npx -y @anthropic-ai/claude-code setup-token` (or `claude setup-token`) on **any** computer — the
  token is bound to the Claude account, not the host — paste it, and Servio stores it encrypted,
  switches the provider and runs a live test. The page's **Test connection** button does the same
  round trip for any provider. Selecting it
  *is* the consent — data does leave the box (to Anthropic), which the settings UI calls out.
- The CLI subprocess gets an **allowlisted** environment (`lib/claude-env.ts`): only what a process
  needs to run (`PATH`, home/profile and temp dirs, Windows system vars, locale, `TZ`, the
  `HTTP(S)_PROXY`/`NO_PROXY` variables, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`) is inherited — none
  of Servio's own configuration (`DATABASE_URL`, `AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`, provider
  keys, …). Only the selected provider's endpoint/credential is set on top; `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`
  keeps telemetry off; `CLAUDE_CODE_MAX_OUTPUT_TOKENS` is only set when `AI_MAX_OUTPUT_TOKENS`
  is a number, floored at 8192 because thinking shares the output budget. Blank / `auto` / `0`
  (**Auto**, the default) leaves it unset, so Claude Code uses the model's own limit.
- **Output-token cap for proxied models.** With Auto, Claude Code asks for the model's full
  Anthropic output budget (32k+), which smaller OpenAI-compatible upstreams reject with a 400. The
  proxy (`lib/llm-proxy/server.ts`, `token-cap.ts`) recognises that max-token error, parses the
  stated limit (or falls back to 8192), retries the request **once** with it and remembers the cap
  per upstream URL + model for an hour, clamping later requests (in memory). A stated cap below
  1024 is treated as a misparse: the fallback is used and nothing is remembered.
- **Thinking** is requested (adaptive, summarized) for Claude backends. Proxied models show their
  reasoning when the upstream streams `reasoning_content`/`reasoning`.

### Sable's isolated agent home (`sable/`, `lib/sable-workspace.ts`)

Sable never runs inside the Servio repo or with the server operator's Claude configuration. On the
first run per process, `ensureSableWorkspace()` prepares `SABLE_HOME` (default `~/.servio/sable`):

- `config/` is Sable's own `CLAUDE_CONFIG_DIR`, holding only `CLAUDE.md` (the charter, copied from
  `sable/AGENT.md`) and `skills/` (the **enabled** skills, see below). `workspace/` is an empty
  working directory.
- The harness loads **only that "user" tier** (`settingSources: ["user"]`). The project tier is off on
  purpose: Claude Code's project lookup walks up parent directories, including their
  `.claude/CLAUDE.md`, which under a home directory would pull in the operator's own instructions.
- Auto-memory is disabled, `strictMcpConfig` keeps out host MCP servers and plugins, sessions are
  not persisted, and the only built-in tool is `Skill` (`skills` lists Sable's own, hiding Claude
  Code's bundled skills). Everything else is Servio's MCP tools.
- **Portal runs** (`streamAiChat({ audience: "portal" })`, the self-service assistant) use
  `ensurePortalWorkspace()` instead: their own **empty** config dir `config-portal/` (and
  `workspace-portal/`), no `Skill` tool and `skills: []` — end users get neither the console charter
  nor any skill. One-shot helpers (`generateAiText`/`generateAiObject`) keep the console scope.

Verified by dumping the full request Claude Code sends upstream: it contains the system prompt,
Sable's charter, the skill index and Servio's tools — no repo path, git state, memory, user
instructions, account e-mail or foreign skills. (The path of Sable's own `CLAUDE.md` appears in
the header; set `SABLE_HOME` outside the home directory if the OS user name must not show.)

**Skills** (loaded on demand — the chat shows an "Applied skill" step) come from two sources and
are managed under **Settings › Sable › Skills** (`components/settings/ai-skills-manager.tsx`,
`lib/actions/sable-skills.ts`, ADMIN):

- **Built-in** ITSM skills versioned in `sable/skills/<name>/SKILL.md`: `incident-triage`,
  `major-incident`, `problem-management`, `change-management`, `knowledge-article`,
  `customer-communication`, `queue-and-sla`, `service-request`. They can be disabled, not edited
  or deleted; disabled names are stored in the `SABLE_DISABLED_SKILLS` setting (comma-separated).
  The Docker image copies `sable/`.
- **Custom** skills are `AiSkill` rows (`name` kebab-case and unique, must not collide with a
  built-in, `description`, markdown `body`, `enabled`). Create, edit, delete, enable/disable, or
  import an existing `SKILL.md` (frontmatter is parsed). Validation and the SKILL.md parse/render
  live in `lib/sable-skills.ts`.

`ensureSableWorkspace()` syncs built-in + enabled custom skills into `config/skills/` (each
`SKILL.md` is written to a temp file and renamed, so a running agent never reads a half-written
one); every skill action calls `invalidateSableWorkspace()`, so the **next agent run** re-syncs — no
restart needed.

### Remote MCP servers (`lib/sable-mcp.ts`, `lib/sable-mcp-policy.ts`)

Admins can connect **remote** MCP servers (HTTP / SSE only — nothing runs on the Servio host) under
**Settings › Sable › MCP servers** (`components/settings/ai-mcp-manager.tsx`,
`lib/actions/sable-mcp.ts`, ADMIN). Each `AiMcpServer` has a slug `name` (the model sees its tools
as `mcp__<name>__<tool>`; `servio` is reserved), `url`, `transport`, optional **headers**
(e.g. `Authorization`, stored **encrypted**; a blank value on edit keeps the stored one — but only
while the URL keeps the same origin: pointing a server at another scheme/host/port requires
re-entering every header value), a `mode`, a `minRole` (`AGENT`/`MANAGER`/`ADMIN`) and `enabled`.
**Test** connects and lists the server's tools.

- **Addresses.** `https://` only — plain `http://` is allowed for `localhost`/`127.0.0.1`/`[::1]`.
  Link-local and cloud-metadata hosts (`169.254.0.0/16`, `fe80::/10`, IPv4-mapped `169.254.x.x`,
  `metadata.google.internal`, `fd00:ec2::254`) are refused. Hostnames are not resolved, so a DNS name
  that points at such an address is not caught.
- **No `$`.** Claude Code expands `${VAR}` in a remote server's URL and header values from its own
  environment (verified for both the `--mcp-config` and the `setMcpServers` path), which would let a
  server config exfiltrate host secrets. The form rejects `$` in the URL and in header names/values,
  and the same check (`remoteServerProblem`) runs again on every stored row before Servio or the CLI
  connects (a hand-edited row is left out with a warning). The CLI env is also allowlisted (above),
  so nothing secret is there to expand.

| Mode | Behaviour |
| --- | --- |
| `READ_ONLY` | Only tools with the MCP `readOnlyHint` annotation run; the rest are hidden from the model |
| `APPROVAL` (default) | Read-only tools run; any other call becomes an approve-first `mcp.call` proposal card |
| `TRUSTED` | Every tool runs directly (still shown live in the chat) |

- **Gating.** Servers are only offered when `AI_ALLOW_EXTERNAL=true` (a server is an external
  destination), only in the **console** chat (`app/api/assistant/chat/route.ts` →
  `resolveRemoteMcp(role)`), and only to users at or above the server's `minRole`. The **portal
  assistant never gets MCP servers**.
- **Approval flow.** In `APPROVAL` mode the harness's permission callback denies the call to the
  model ("not executed, waiting for approval") and records an `mcp.call` proposal
  (`lib/ai-operations/modules/mcp.ts`), which the chat renders as a card (`sable-tool-ui.tsx`;
  `lib/claude-agent-events.ts` swaps the denial for the proposal). The proposal pins the server by
  **id and name** (`args.serverId` + `args.server`). Approving runs `executeApprovedMcpCall`, which
  **re-checks** the privacy gate, that this very server (same id AND name) still exists, is enabled
  and not `READ_ONLY`, and the approver's current role against `minRole`
  (`approvedCallProblem`), then writes an `AuditLog` row for every call that reached the server —
  successful or failed (`meta.outcome`).
- **Cards only from the harness.** A remote tool's real output is shown as **plain text** — the event
  mapper never JSON-parses it — so the only object a remote call's output can be is the harness's
  substitute for an intercepted call; that one must still be the `mcp.call` proposal for that exact
  call to show a card.
- **Tool names.** Tools whose names don't match `[A-Za-z0-9_.-]{1,64}` are hidden and denied, and
  when two names collide after Claude Code's sanitising (`issue.get` vs `issue_get`) **both** are
  dropped, so neither can run under the other's policy.
- **Header secrets stay off the command line.** The SDK would hand `options.mcpServers` to the CLI as
  a `--mcp-config` argument — visible to anyone who can list processes on the host. Servio instead
  registers remote servers over the SDK control channel (`query.setMcpServers`, stdin) and holds the
  prompt back until they are connected (`lib/claude-cli.ts`, `connectRemoteServers`). Verified: the
  CLI's command line carries neither `--mcp-config` nor the header value.
- **Known gap: replay.** `applyAssistantProposal` takes the proposal from the client, so an
  `mcp.call` can be approved again (or one composed by hand) by a user who meets the server's
  `minRole`; every run is audited. Binding approval to the persisted proposal is open.
- **Trust caveat.** "Read-only" comes from the server's own `readOnlyHint`; Servio cannot verify
  it. Use `READ_ONLY`/`APPROVAL` only for servers you trust to annotate honestly, and `TRUSTED`
  sparingly.
- **Reload.** Tool lists are discovered per chat turn and cached for 5 minutes per server version
  (saving or deleting a server drops its entry at once). All of a turn's discovery shares one
  **5 s deadline**; a slower or unreachable server is left out of that turn, and a failed discovery is
  not retried for 60 s. A server listing more than **128 tools** is left out (warning in the log);
  descriptions in Servio's copy are cut at 1 KB (the CLI lists the tools itself for the model).
  Changes apply to the next message — no restart.

### Settings page (`/settings/ai`, ADMIN)

`app/(console)/settings/ai/page.tsx` loads the values and `components/settings/ai-settings-form.tsx`
renders them:

- A **status card** (configured or not) with a **Test connection** button that runs a live round trip
  for the saved provider (`testAiConnection`).
- **Provider tiles**, then per-provider fields (keys, Ollama URL/model); the **Connect Claude** dialog
  (`claude-connect-dialog.tsx`) for the subscription token.
- **Model dropdown** (`ModelField`): `listAiModels(provider)` (`lib/actions/settings.ts`, ADMIN) calls
  `listModels` in `lib/ai-models.ts` with the **saved** credentials — Anthropic `/v1/models`, the
  OpenAI-compatible and Ollama model endpoints, or the Claude Code CLI itself for the subscription.
  It never throws: on failure (or no saved key yet) it shows the error, with a static Claude fallback
  list where useful, and a model id can always be typed by hand. A refresh button reloads it. For the
  external providers (Anthropic, OpenAI-compatible) nothing is fetched while `AI_ALLOW_EXTERNAL` is
  off — the saved key never leaves the box just to fill a dropdown.
- **Max output tokens** (blank = Auto), privacy and behaviour switches, then the **Skills** and
  **MCP servers** managers described above.

### The built-in LLM proxy (`lib/llm-proxy/`)

Claude Code only speaks the Anthropic Messages API, so `openai`/`ollama` go through a small
translation proxy that starts **automatically** inside the Servio process on first use:

- Binds `127.0.0.1` on a random port (a `globalThis` singleton, survives dev HMR, `unref()`ed).
- Each run **leases** a route: a random per-run token (passed to the CLI as `ANTHROPIC_AUTH_TOKEN`)
  mapped to the upstream URL, key and model. The upstream API key never leaves the Node process;
  the lease is released when the run ends.
- `POST /v1/messages` (streaming and non-streaming) and `POST /v1/messages/count_tokens`;
  `translate.ts` converts system blocks, images, tool use/results, tool choice and stop reasons, and
  turns OpenAI SSE chunks (text, `reasoning_content`, fragmented tool-call arguments, usage) into the
  exact Anthropic event sequence. The upstream model is always the configured one.

### The privacy gate

`AI_ALLOW_EXTERNAL` is a hard backstop (it also gates remote MCP servers). When it is not exactly `"true"`, `assertPrivacy()` in
`lib/ai.ts` **throws before any network call** for a non-local provider — so a misconfiguration
can never send ticket data off-box. Local (`ollama`) and subscription (`claude-code`) providers
authorize themselves and are not subject to the gate.

`aiConfigured()` is the effective on/off switch (mirrors `smtpConfigured()`): true only when the
selected provider can actually run (local always; external only with the gate open **and** a key).

### Teaser mode

When AI is *not* configured, `AI_TEASER=true` still renders the AI buttons as a preview. Clicking
one shows a friendly "ask your admin to enable AI" hint instead of calling anything — a nudge, not
a live feature.

---

## Configuration

All keys are read through `lib/settings` (DB overrides `.env`); secrets are encrypted at rest
(AES-256-GCM). Manage them under **Settings › Sable (AI assistant)** (ADMIN) or in `.env`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AI_PROVIDER` | `anthropic` | `anthropic` \| `openai` \| `ollama` \| `claude-code` |
| `AI_ALLOW_EXTERNAL` | `false` | Privacy gate — must be `true` to use anthropic/openai |
| `AI_MODEL` | provider default | Explicit model id (blank = provider default); the settings page offers a live dropdown |
| `AI_MAX_OUTPUT_TOKENS` | blank (Auto) | Output token cap; blank / `auto` / `0` = model default, a number is floored at 8192 |
| `AI_TEASER` | `false` | Show AI buttons as a preview when AI is off |
| `ANTHROPIC_API_KEY` | — | Anthropic key (external; needs the gate) |
| `OPENAI_API_KEY` | — | OpenAI key (external; needs the gate) |
| `OPENAI_BASE_URL` | — | Override endpoint for any OpenAI-compatible cloud |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | Local Ollama endpoint |
| `OLLAMA_MODEL` | `llama3.1` | Local Ollama model |

### Quick start: local, private (Ollama)

```dotenv
AI_PROVIDER="ollama"
OLLAMA_BASE_URL="http://localhost:11434/v1"
OLLAMA_MODEL="llama3.1"
```

### Quick start: hosted model (Anthropic / OpenAI)

```dotenv
AI_PROVIDER="anthropic"       # or "openai"
AI_ALLOW_EXTERNAL="true"      # required for any external provider
ANTHROPIC_API_KEY="sk-ant-…"  # or OPENAI_API_KEY (+ optional OPENAI_BASE_URL)
```

---

## Conversation persistence & folders

Chats are saved per user (base migration
`20260809000000_vio_assistant_conversations`, plus the folder additions in the schema):

- **`AiConversation`** — `title` (auto-titled from the first user message), `scope`
  (`GENERAL`/`ADMIN`), `archived`, `folderId` (optional), timestamps, owner. Indexed by
  `(userId, archived, updatedAt)` so the left rail sorts newest-first.
- **`AiMessage`** — one turn: `role` (`user`/`assistant`), `content`, sanitized `html`,
  `toolCalls` (JSON), and `proposals` (JSON). Cascades with its conversation.
- **`AiProposalDecision`** — the user's decision on one proposal: `proposalKey` (unique per
  conversation), `status` (`APPLYING`/`APPLIED`/`DISMISSED`), `claimId`, `summary`. Cascades with
  its conversation.
- **`AiFolder`** — a per-user folder (`id`, `userId`, `name`, timestamps). Deleting a folder just
  **un-groups** its chats (`AiConversation.folderId` is `onDelete: SetNull`) — it never deletes
  conversations. `folderId` is indexed.

A conversation can be renamed, archived (soft-delete), and moved between folders. Each message
accepts up to six attachments (images are downscaled client-side; text is inlined; PDFs are sent as
file parts to providers that support them).

### The rail

`components/assistant/sable-rail.tsx` is the premium left rail shown in the max window: **New chat**,
a search box, user **folders**
(create / rename / delete, with `@dnd-kit` drag to move chats in and out), and a collapsible
**Archived** section. Its folder + conversation actions call the server actions in
`lib/actions/ai-assistant.ts`: `listFolders` / `createFolder` / `renameFolder` / `deleteFolder` /
`moveConversation`, plus `listConversations` / `renameConversation` / `archiveConversation`.

---

## Sable in the self-service portal (end users)

The help center has its own **USER-scoped** Sable — a floating widget
(`components/portal/sable-widget.tsx`, launched with the same `SableFab`) mounted in
`app/portal/layout.tsx`, gated by the same `aiConfigured()` / `aiTeaserEnabled()` switches. It is
deliberately smaller and safer than the console Sable and shares **none** of the agent tools.

The portal is being migrated to the **same assistant-ui `Thread`** used by the console: a streaming
portal route `app/api/portal/assistant/route.ts` with a portal tool UI for the ticket / service /
comment confirm cards. In the end state the portal renders the identical assistant-ui surface — a
USER-scoped, confirm-to-create variant of the console thread.

- **Backend:** `lib/portal-assistant.ts` builds a per-request tool set bound to the caller's id
  (`buildPortalTools(userId)`). Chat runs through `app/api/portal/assistant/route.ts`; drafts are
  confirmed via `app/api/portal/assistant/create/route.ts`.
- **Read tools (public / own only):** `search_knowledge` (published **public** articles),
  `search_catalog`, `list_categories`, `get_service_form`, keyless `web_search` / `fetch_url`, and
  the caller's **own** tickets — `list_my_tickets` / `get_my_ticket` (public content only; internal
  notes are excluded by the same `isInternal: false` filter the portal UI uses), and
  `list_status_incidents` (**public** status incidents only; the system prompt tells the model to check it
  first when a user reports something down and to point at `/portal/status` instead of opening a duplicate).
- **Confirm-first writes:** every `propose_*` only drafts; the widget renders a confirm card and the
  create route re-validates server-side before acting as the signed-in user:
  - `propose_request` → `createPortalTicketFor` (routed ticket with type / priority / impact /
    urgency and an optional category),
  - `propose_service_request` → `createCatalogRequestFor` (fills a catalog item's dynamic form),
  - `propose_reply` → `addPortalReply` (a **public** reply on one of the user's own open tickets).

  Portal/Sable tickets carry `source: "SABLE"` — a neutral "Sable" badge (`SOURCE_META.SABLE`, whose
  label reads from `AI_ASSISTANT_NAME`).
- **Attachments & vision:** the widget stages files (images / PDF / …, incl. `.eml`) and sends the
  current turn to a vision-capable model; anything attached is linked onto the ticket Sable opens. Images
  are passed to Claude Code as real Anthropic content blocks (`lib/claude-cli.ts`) instead of being
  flattened to text; the built-in proxy forwards them as `image_url` parts to OpenAI-compatible models.

The shared creation core (`lib/portal-tickets.ts`) routes catalog requests to the item's
**service team → category team → Service Desk triage**, runs automations, then auto-assigns; free-form
tickets default to Service Desk triage. Team ownership on `Service` / `Category` (`groupId`) is
informational (surfaced to Sable) and only *pre-routes* catalog requests — it never auto-routes
free-form tickets.

---

## Design tokens

Sable uses **Nova Flow**: six separate curved segments and an outlined Manrope
wordmark. `components/sable-mark.tsx` supplies the common SVG for chat,
navigation, settings and inline AI affordances. `BrandName` renders the
wordmark. Both read generated geometry from `lib/brand-assets.ts`.

Dense AI surfaces use monochrome `--sable`, `--sable-foreground` and
`--sable-muted` tokens: Navy/white on light, white/Navy on dark. Consumers include
`AiButton`, ticket triage suggestions, comment draft/summary cards and composer
controls. The launcher uses a Navy tile with the Cobalt/Ice accent symbol;
`sable-accent-border` and `sable-glow` use those same two colours.

Headings use local Manrope; body text remains Inter. See
[branding.md](./branding.md) and [design-system.md](./design-system.md).

---

## File map

| Concern | Files |
| --- | --- |
| Window & state | `components/assistant/{sable-provider,sable-mount,sable-window,sable-fab,sable-chrome}.tsx` |
| Chat surface | `components/assistant/{sable-thread,sable-tool-ui,proposal-card,sable-read-cards,sable-rail,composer-commands,typing-dots}.tsx` |
| Artifacts / canvas | `components/assistant/{sable-canvas,canvas-code}.tsx`, `lib/assistant-tools.ts` (`draft_document`) |
| Projects | `components/assistant/{project-home,project-rail-section,project-file-browser}.tsx`, `lib/ai-projects.ts`, `lib/actions/ai-project-files.ts` |
| Office previews | `lib/office-convert.ts`, `app/api/files/[id]/{preview,pdf}/route.ts`, `lib/rag/render.ts`, `components/file-preview.tsx` |
| assistant-ui thread | `components/thread.tsx` + `components/{markdown-text,reasoning,tool-fallback,tool-group,tooltip-icon-button,attachment,follow-up-suggestions}.tsx` |
| Inline route | `app/(console)/assistant/{page,layout}.tsx` (route `/assistant`) |
| Streaming route | `app/api/assistant/chat/route.ts` (POST, AGENT+) |
| Shared pre-model core | `lib/assistant-core.ts` (identity, `prepareAssistantTurn`, prompts, proposals, uploads) |
| Server actions | `lib/actions/ai-assistant.ts` (conversation + folder CRUD, `applyAssistantProposal`; shared types) |
| Provider layer | `lib/ai.ts` (config, gate, `openClaudeBackend`, `streamAiChat`, `generateAi*`), `lib/ai-models.ts` (model lists for the settings dropdown), `lib/claude-cli.ts` (Claude Code harness; `remoteMcp`, `audience`), `lib/claude-env.ts` (allowlisted CLI env), `lib/claude-agent-events.ts` (SDK events → live UI chunks), `lib/llm-proxy/{server,translate,token-cap}.ts` (built-in Anthropic⇄OpenAI proxy) |
| Skills & MCP | `lib/sable-skills.ts`, `lib/sable-workspace.ts`, `lib/actions/sable-skills.ts`, `lib/sable-mcp.ts`, `lib/sable-mcp-policy.ts`, `lib/actions/sable-mcp.ts`, `lib/ai-operations/modules/mcp.ts` |
| Read tools | `lib/assistant-tools.ts`, `lib/ai-tools.ts`, `lib/ai-admin-tools.ts`, `lib/ai-stats.ts` |
| Write operations | `lib/ai-operations/` (`registry.ts`, `types.ts`, `tools.ts`, `modules/*`) |
| Insights & copilots | `lib/ai-similarity.ts`, `lib/ai-similarity-search.ts`, `lib/ai-insights.ts`, `lib/ai-insights-rules.ts`, `lib/ai-insights-handling.ts`, `lib/ticks/ai-insights.ts`, `lib/actions/ai-insights.ts`, `app/(console)/insights/`, `components/ai/`, `lib/change-brief.ts`, `lib/actions/change-copilot.ts`, `lib/dashboard/briefing*.ts`, `lib/ticks/sla-nudges.ts`, `lib/sla-nudge-rules.ts` |
| Portal | `components/portal/sable-widget.tsx`, `lib/portal-assistant.ts`, `lib/portal-tickets.ts`, `app/api/portal/assistant/{route,create/route}.ts` |
| Settings UI | `app/(console)/settings/ai/page.tsx` + `components/settings/{ai-settings-form,claude-connect-dialog,ai-skills-manager,ai-mcp-manager}.tsx` (provider, model, web-search keys, skills, MCP servers), `app/(console)/settings/uploads/page.tsx` (`GOTENBERG_URL`) |
| Persistence | `prisma/schema.prisma` (`AiConversation`, `AiMessage`, `AiProposalDecision`, `AiFolder`; `AiSkill`, `AiMcpServer`; `AiProject`/`AiProjectFolder`/`AiProjectFile`/`AiProjectChunk`) |

---

## Related docs

- [configuration.md](configuration.md) — the full environment-variable reference.
- [architecture.md](architecture.md) — server-first runtime, Server Actions, RBAC.
- [data-model.md](data-model.md) — the Prisma schema and enum strategy.
</content>
</invoke>
