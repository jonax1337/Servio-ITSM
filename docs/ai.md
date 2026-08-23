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
  persisted in `localStorage` (keyed `sable:prop:…`) so a proposal can't be re-approved after the
  thread re-hydrates.

`components/assistant/sable-window.tsx` frames the thread (header + the max-state rail) and keeps a
single `<SableThread>` mounted across the min↔max morph so an in-flight stream is never lost.

---

## The streaming route

Chat runs through **`app/api/assistant/chat/route.ts`** (`POST`, AGENT+). It is
**server-authoritative**: assistant-ui/`useChat` posts the full `messages[]` array, but the route
ignores that history and **rebuilds context from the DB**, then streams the reply.

The pre-model logic is shared, non-`"use server"` code in **`lib/assistant-core.ts`**:

- `getActingAgent()` — the acting user with a **fresh** role from the DB (never the stale JWT).
- `prepareAssistantTurn()` — authorise the conversation + scope, persist the user turn, auto-title
  from the first message, load bounded history (last 16 turns), and assemble system + messages +
  tools. Returns everything up to (but not including) the model call.
- `buildUserContent()` / `sanitizeUploads()` — turn uploads into multimodal model content
  (images → image parts, text files inlined, PDFs → file parts) with a text-only fallback.
- `generalSystemPrompt` / `adminSystemPrompt` — the per-scope system prompts.
- `buildAssistantProposals()` — turn `propose_*` tool calls into deduped approval cards.

Streaming itself:

- **ai-sdk providers (anthropic / openai / ollama)** → `streamText` → `toUIMessageStreamResponse`,
  with real token streaming; proposals ride to the client as message metadata on `finish`, and the
  finished turn is persisted in `onFinish`.
- **`claude-code` (subscription CLI)** → buffered `generateAiChat`, emitted as a single uniform UI
  message stream (read-tool parts, then the answer, then the proposal cards are **synthesised** so
  the client stays uniform).

`lib/ai.ts` exposes the helpers the route needs: `currentProvider`, `resolveChatModel`,
`chatMaxOutputTokens` (plus the existing `generateAiChat`).

> **Server actions.** `lib/actions/ai-assistant.ts` keeps the conversation/folder CRUD and
> `applyAssistantProposal` (below). Its legacy `sendMessage` server action still exists but is
> **retired for the console** — the streaming route is the live path.

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
- `draft_document` — hand a long document or **script** to the read-only **canvas** (see
  [Artifacts & the canvas](#artifacts--the-canvas)).

The web pages, KB articles and project files a turn grounded on are aggregated into a **"Sources"**
row rendered under the answer (a synthetic `cited_sources` part on the claude-code path;
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
| Tickets | `modules/tickets.ts` | create, update field/status/priority/type, comment, resolve, escalate, link, tasks, work-log, watch, major-incident |
| Categories | `modules/taxonomy.ts` | category create/update |
| Groups & Users | `modules/org.ts` | group create / auto-assign, user field (role/active — ADMIN) |
| Services & Catalog | `modules/catalog-services.ts` | service create/update, catalog item create/publish/delete |
| Assets & Locations (CMDB) | `modules/cmdb.ts` | asset create/update, location create/update/delete |
| Knowledge base | `modules/knowledge.ts` | article create, set status, delete |
| Problems & Changes | `modules/problems-changes.ts` | problem/change create, update field, comment |
| SLAs, Automations, Settings | `modules/config.ts` | SLA CRUD, automation toggle/delete, setting update (ADMIN) |

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
accountable as — manual ones. Approve/dismiss state is remembered per proposal in `localStorage`
so a card can't be re-approved after the thread re-renders.

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

| Provider | `AI_PROVIDER` | Runs | Key | Privacy gate | Default model |
| --- | --- | --- | --- | --- | --- |
| **Ollama** | `ollama` | **Local, on-box** | none | not gated (self-authorized) | `OLLAMA_MODEL` (`llama3.1`) |
| **Anthropic** | `anthropic` | External API | `ANTHROPIC_API_KEY` | **requires `AI_ALLOW_EXTERNAL=true`** | `claude-opus-4-8` |
| **OpenAI-compatible** | `openai` | External API | `OPENAI_API_KEY` | **requires `AI_ALLOW_EXTERNAL=true`** | `gpt-4o` |
| **Claude subscription** | `claude-code` | Local `claude` CLI | none (your login) | not gated (self-authorized) | CLI default |

- **Ollama** is a local, OpenAI-compatible endpoint — no key, data stays on the machine. This is
  the privacy-safe default and the recommended way to try Sable.
- **OpenAI-compatible** works with any compatible cloud via `OPENAI_BASE_URL` (OpenAI, OpenRouter,
  Moonshot/Kimi, Zhipu/GLM, …); the model id comes from `AI_MODEL`.
- **Claude subscription** (`claude-code`) drives the operator's own logged-in `claude` CLI (their
  Pro/Max plan) through the Claude Agent SDK (`lib/claude-cli.ts`). Selecting it *is* the consent —
  data does leave the box (to Anthropic), which the settings UI calls out. This path is **buffered**:
  the streaming route synthesises the tool/answer/proposal parts so the client behaves identically.

### The privacy gate

`AI_ALLOW_EXTERNAL` is a hard backstop. When it is not exactly `"true"`, `assertPrivacy()` in
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
| `AI_MODEL` | provider default | Explicit model id (blank = provider default) |
| `AI_MAX_OUTPUT_TOKENS` | `1024` | Output token cap |
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
  notes are excluded by the same `isInternal: false` filter the portal UI uses).
- **Confirm-first writes:** every `propose_*` only drafts; the widget renders a confirm card and the
  create route re-validates server-side before acting as the signed-in user:
  - `propose_request` → `createPortalTicketFor` (routed ticket with type / priority / impact /
    urgency and an optional category),
  - `propose_service_request` → `createCatalogRequestFor` (fills a catalog item's dynamic form),
  - `propose_reply` → `addPortalReply` (a **public** reply on one of the user's own open tickets).

  Portal/Sable tickets carry `source: "SABLE"` — a neutral "Sable" badge (`SOURCE_META.SABLE`, whose
  label reads from `AI_ASSISTANT_NAME`).
- **Attachments & vision:** the widget stages files (images / PDF / …, incl. `.eml`) and sends the
  current turn to a vision-capable model; anything attached is linked onto the ticket Sable opens. On
  the `claude-code` backend images are passed as real Anthropic content blocks
  (`lib/claude-cli.ts`) instead of being flattened to text.

The shared creation core (`lib/portal-tickets.ts`) routes catalog requests to the item's
**service team → category team → Service Desk triage**, runs automations, then auto-assigns; free-form
tickets default to Service Desk triage. Team ownership on `Service` / `Category` (`groupId`) is
informational (surfaced to Sable) and only *pre-routes* catalog requests — it never auto-routes
free-form tickets.

---

## Design tokens

Sable — and every AI affordance in the app — uses a **monochrome** accent, not the old violet/fuchsia.
The tokens live in `app/globals.css` (`:root` + `.dark`): `--sable`, `--sable-foreground`, `--sable-muted`,
mapped in `@theme inline` to Tailwind's `bg-sable` / `text-sable` / `text-sable-foreground` / `bg-sable-muted`.
Change the three `--sable*` variables to retint everything at once.

These replaced the old AI accent across Sable and the app's AI affordances: `components/ui/ai-button.tsx`,
the ticket triage per-field suggestions (`components/tickets/ticket-properties.tsx`), and the AI
draft/summary card (`components/comments/comment-thread.tsx`) are all `sable`-tinted, as are the
assistant-ui composer send button and caret. The Sable wordmark uses the app display font
(Bricolage Grotesque, `font-display font-semibold`).

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
| Provider layer | `lib/ai.ts` (config, gate, `currentProvider`/`resolveChatModel`/`chatMaxOutputTokens`, `generateAi*`), `lib/claude-cli.ts` (Agent SDK adapter) |
| Read tools | `lib/assistant-tools.ts`, `lib/ai-tools.ts`, `lib/ai-admin-tools.ts`, `lib/ai-stats.ts` |
| Write operations | `lib/ai-operations/` (`registry.ts`, `types.ts`, `tools.ts`, `modules/*`) |
| Portal | `components/portal/sable-widget.tsx`, `lib/portal-assistant.ts`, `lib/portal-tickets.ts`, `app/api/portal/assistant/{route,create/route}.ts` |
| Settings UI | `app/(console)/settings/ai/page.tsx` (provider, model, web-search keys), `app/(console)/settings/uploads/page.tsx` (`GOTENBERG_URL`) |
| Persistence | `prisma/schema.prisma` (`AiConversation`, `AiMessage`, `AiFolder`; `AiProject`/`AiProjectFolder`/`AiProjectFile`/`AiProjectChunk`) |

---

## Related docs

- [configuration.md](configuration.md) — the full environment-variable reference.
- [architecture.md](architecture.md) — server-first runtime, Server Actions, RBAC.
- [data-model.md](data-model.md) — the Prisma schema and enum strategy.
</content>
</invoke>
