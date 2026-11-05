# REST API Reference

Servio ships a small, stable, versioned REST API for integrations, scripts, and
automation. It is a separate surface from the app's internal Server Actions (which
power the UI): the REST API is authenticated with **Bearer API tokens**, returns a
consistent JSON envelope, and lives under `/api/v1`.

The implementation is in [`app/api/v1/`](../app/api/v1); shared auth/envelope/pagination
helpers are in [`lib/api.ts`](../lib/api.ts); token minting/revocation is in
[`lib/actions/tokens.ts`](../lib/actions/tokens.ts).

See also: [data-model.md](./data-model.md) for entity/enum definitions and
[configuration.md](./configuration.md) for environment variables (e.g. `API_CORS_ORIGIN`).

---

## 🔑 Authentication

All `/api/v1` endpoints (except the index and the OpenAPI spec) require a Bearer token:

```
Authorization: Bearer <token>
```

### Creating a token

Tokens are **personal access tokens** (PATs) tied to a user. Create them in the app:

1. Sign in as an admin and open **Settings › API Tokens** (route
   `app/(console)/settings/api/page.tsx`,
   URL `/settings/api`). The page is gated by `requireRole("ADMIN")`.
2. Enter a name, choose a scope set, and click **Generate token**.
3. **Copy the token immediately** — the full value is shown exactly once. Only a
   short prefix and a bcrypt hash are stored, so it cannot be recovered later.

Under the hood ([`createApiToken`](../lib/actions/tokens.ts)):

| Property | Value |
| --- | --- |
| Raw token format | `servio_pat_` + `nanoid(32)` |
| Stored `prefix` | first **18** chars of the raw token (`raw.slice(0, 18)`) |
| Stored `tokenHash` | `bcrypt.hash(raw, 10)` — the raw token is never persisted |
| Owner | the creating user (`userId`) |
| Scopes | one of the sets below, stored as a comma-separated string |

### How verification works

[`authenticateApi`](../lib/api.ts) parses `Authorization: Bearer <token>`, then:

1. Looks up the non-revoked token whose `prefix` equals the first 18 chars of the
   presented token. On a prefix miss it **fails immediately** — a constant-work
   `bcrypt.compare` against a dummy hash keeps timing uniform, and it no longer
   scans every token (that O(N) bcrypt fallback was removed to prevent CPU-DoS).
2. Skips any token past its `expiresAt`.
3. Confirms the candidate with `bcrypt.compare(raw, tokenHash)`.
4. Loads the owning user and **rejects the request if the user is missing or
   `isActive === false`** (a deactivated owner disables their tokens).
5. Stamps `lastUsedAt` and returns the principal (`tokenId`, `userId`, `scopes`, `role`).

### Scopes

Scopes are stored as a comma-separated string and checked with
[`requireScope`](../lib/api.ts). A token holding `admin` implicitly satisfies every
scope check. The three scope sets offered in the UI (`SCOPE_OPTIONS` in
[`token-manager.tsx`](../components/settings/token-manager.tsx)) are:

| Scope set | Grants |
| --- | --- |
| `read` | Read-only (`GET`) |
| `read,write` | Read + create/update (`GET`, `POST`, `PATCH`) |
| `read,write,admin` | Read + write, and satisfies any future `admin`-gated checks |

Each protected handler calls `guard(req, "read" | "write")`, which returns `401` if
the token is invalid and `403` if it lacks the required scope.

### Actor scoping (agent vs. user)

Authorization also depends on the **role of the token owner**, not just the scope
([`principalIsAgent`](../lib/api.ts)): `AGENT`, `MANAGER`, and `ADMIN` are "agents"
and may act org-wide; a plain `USER` is scoped to their own objects.

| Owner role | Ticket reads | Ticket create | Ticket update |
| --- | --- | --- | --- |
| Agent (`AGENT`/`MANAGER`/`ADMIN`) | all tickets | may set `requesterId`, `status`, `assigneeId`, etc.; `source` forced to `API` | allowed |
| User (`USER`) | only tickets they requested | files as **themselves only** (server-controlled fields ignored, defaults applied) | **not allowed** — returns `404` |

To avoid leaking existence, a non-agent requesting a ticket they don't own gets
`404`, not `403`. **Assets and Services are agent-only**: a non-agent (`USER`) token
gets `403` on every `/assets` and `/services` request — the CMDB and catalog are
agent data and cannot be enumerated by a plain user token.

When an agent sets `assigneeId` on ticket create/update, the assignee is validated
(must be an active `AGENT` who — if the ticket has a group — belongs to that group);
an invalid assignee returns `422`, not a `500`.

### Revoking a token

Revoke from the same **Settings › API Tokens** page. [`revokeApiToken`](../lib/actions/tokens.ts)
sets `revoked = true`. Non-admins may only revoke their own tokens; admins may
revoke any. Revoked tokens are excluded from authentication immediately.

---

## Base URL & versioning

| | |
| --- | --- |
| Base path | `/api/v1` |
| Current version | `1.0.0` (see `GET /api/v1`) |
| Content type | `application/json` |
| Runtime | Node.js (`runtime = "nodejs"`); list/detail routes are `dynamic = "force-dynamic"` |
| CORS | Default **closed**: no `Access-Control-*` headers are emitted unless `API_CORS_ORIGIN` is set to an explicit origin (never `*`); when set, methods `GET, POST, PATCH, OPTIONS`, allowed headers `Authorization, Content-Type`. Every route implements `OPTIONS` (preflight → `204`). |

Because these are Bearer-token endpoints, they do not rely on cookies.

---

## Response envelope

Success responses wrap the payload in a `data` key. List endpoints add a `meta`
object with pagination info ([`ok`](../lib/api.ts) / [`pageMeta`](../lib/api.ts)):

```json
{
  "data": [ /* ... resources ... */ ],
  "meta": { "page": 1, "per_page": 25, "total": 137, "total_pages": 6 }
}
```

Single-resource responses omit `meta`:

```json
{ "data": { "id": 42, "ref": "INC-0042", "title": "Laptop won't boot" } }
```

Errors use a single `error` object ([`apiError`](../lib/api.ts)); `details` is present
only for validation failures:

```json
{ "error": { "message": "Validation failed", "details": { "title": ["Too small: ..."] } } }
```

### Status codes

| Code | When |
| --- | --- |
| `200` | Successful `GET` / `PATCH` |
| `201` | Resource created (`POST`) |
| `204` | `OPTIONS` preflight |
| `400` | Malformed JSON body |
| `401` | Missing or invalid token |
| `403` | Token lacks the required scope, or is a non-agent hitting an agent-only resource (`/assets`, `/services`) |
| `404` | Resource not found (or hidden from a non-agent) |
| `409` | Illegal ticket status transition, or a request awaiting approval (only cancelling is allowed) |
| `422` | Zod validation failed, or an invalid `assigneeId` (`details` holds field errors) |
| `429` | Rate limit exceeded — a `Retry-After` header is returned |

The API is rate-limited per token (falling back to client IP) with an in-memory
sliding window; a `429` carries `Retry-After`. Limits are per-process and env-tunable
(`API_RATE_LIMIT`, `API_RATE_WINDOW_MS`) — see the multi-instance caveat in
[deployment.md](./deployment.md). Login is separately throttled with failed-attempt
lockout + backoff. Token creation/revocation is **ADMIN-only**.

---

## Pagination, filtering & sorting

Pagination applies to the two list endpoints (`GET /tickets`, `GET /assets`) via
[`paginate`](../lib/api.ts):

| Param | Default | Bounds |
| --- | --- | --- |
| `page` | `1` | `>= 1` |
| `per_page` | `25` | `1`–`100` (clamped) |

**Filtering** is per-endpoint (only the params below exist — anything else is ignored):

| Endpoint | Filters |
| --- | --- |
| `GET /tickets` | `status` (exact, or the special value `open` → any open status), `priority`, `type`, `q` (substring match on `title`) |
| `GET /assets` | `type`, `status`, `q` (substring match across `name`, `assetTag`, `serial`) |

**Sorting is fixed** (not client-configurable): tickets by `updatedAt` descending,
assets by `name` ascending, services by `name` ascending.

---

## Endpoint reference

Paths are relative to `/api/v1`. "Scope" is the scope required by the handler; the
`admin` scope satisfies all of them.

| Method | Path | Description | Scope |
| --- | --- | --- | --- |
| `GET` | `/` | API index: name, version, and resource links. **No auth.** | — |
| `GET` | `/openapi` | OpenAPI 3.1 spec (JSON). **No auth.** | — |
| `GET` | `/tickets` | List tickets (paginated, filterable). Non-agents see only their own. | `read` |
| `POST` | `/tickets` | Create a ticket (`source = API`). | `write` |
| `GET` | `/tickets/{id}` | Get one ticket by numeric id. | `read` |
| `PATCH` | `/tickets/{id}` | Update a ticket (agents only). Enforces status-transition rules + SLA clock. | `write` |
| `GET` | `/assets` | List assets (paginated, filterable). | `read` |
| `POST` | `/assets` | Create an asset. | `write` |
| `GET` | `/assets/{id}` | Get one asset by id (cuid string). | `read` |
| `PATCH` | `/assets/{id}` | Update an asset. | `write` |
| `GET` | `/services` | List services with status, criticality, category, and SLA (not paginated). | `read` |

### Tickets

Ticket `id` is a **numeric** id; the serializer also returns a human `ref`
(`INC-0001` / `REQ-0001`, from [`ticketRef`](../lib/constants.ts)). Field names in
the JSON payload are `snake_case` even though the DB columns are `camelCase` (see
[`_serializers.ts`](../app/api/v1/_serializers.ts)).

**Serialized ticket shape:**

```json
{
  "id": 42,
  "ref": "INC-0042",
  "title": "Laptop won't boot",
  "description": "…",
  "type": "INCIDENT",
  "status": "OPEN",
  "priority": "HIGH",
  "impact": "MEDIUM",
  "urgency": "MEDIUM",
  "source": "API",
  "requester": { "id": "…", "name": "Ada Lovelace", "email": "ada@servio.dev" },
  "assignee": null,
  "category_id": null,
  "service_id": null,
  "due_at": null,
  "resolved_at": null,
  "created_at": "2026-08-09T10:00:00.000Z",
  "updated_at": "2026-08-09T10:00:00.000Z"
}
```

**`POST /tickets` body** (validated by Zod; see enums in
[`lib/constants.ts`](../lib/constants.ts)):

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `title` | string (min 3) | — | required |
| `description` | string | `""` | |
| `type` | `INCIDENT` \| `REQUEST` | `INCIDENT` | |
| `priority` | `LOW`\|`MEDIUM`\|`HIGH`\|`CRITICAL` | `MEDIUM` | |
| `impact` | `LOW`\|`MEDIUM`\|`HIGH` | `MEDIUM` | |
| `urgency` | `LOW`\|`MEDIUM`\|`HIGH` | `MEDIUM` | |
| `status` | ticket status enum — **open statuses only** | `NEW` | **agents only** |
| `requesterId` | string | caller | **agents only**; non-agents always file as themselves |
| `assigneeId`, `categoryId`, `serviceId` | string | — | **agents only**; unknown `categoryId`/`serviceId`/`requesterId` ids return `422` |

For non-agent tokens, only `title`, `description`, `type`, `priority`, `impact`,
`urgency` are honored; all other fields fall back to defaults. SLA response/resolve
deadlines are resolved from the service + priority at creation time. Agents may
pick a starting status, but only an **open** one (`NEW`, `OPEN`, `IN_PROGRESS`,
`PENDING`, `ON_HOLD`) — a ticket can't be born `RESOLVED`/`CLOSED`/`CANCELLED`,
which would skip breach stamping, automations and the survey pipeline (else `422`).

**`PATCH /tickets/{id}` body** (agents only): `title`, `description`, `status`,
`priority`, `assigneeId` (nullable). Changing `status`:

- The transition is validated against the **admin-configured workflow**
  ([`lib/workflow.ts`](../lib/workflow.ts): built-in map + admin overrides + role
  gates — the same rules the console enforces); a disallowed move returns `409`.
- A ticket merged into another (`mergedIntoId` set) can only move to `CANCELLED`; any other status returns `409` (undo the merge in the console first).
- Moving into `PENDING`/`ON_HOLD` pauses the SLA clock (in business time when the
  SLA carries a calendar); moving out resumes it.
- While a catalog request awaits approval (`approvalState` `PENDING`) the only
  allowed status change is `CANCELLED`; anything else returns `409`. Cancelling it
  sets `approvalState` to `CANCELLED` and withdraws the pending approvals.
- Changing `priority` re-measures the SLA response/resolve deadlines from the
  ticket's creation plus its banked pause time (the clock never restarts), via the
  shared `slaRepricePatch` (same contract as the console's `updateTicketField`).
- `RESOLVED` sets `resolvedAt` and computes `resolveBreached`; `CLOSED` sets `closedAt`.

Ticket status enum: `NEW`, `OPEN`, `IN_PROGRESS`, `PENDING`, `ON_HOLD`, `RESOLVED`,
`CLOSED`, `CANCELLED`. Open statuses (matched by `?status=open`): `NEW`, `OPEN`,
`IN_PROGRESS`, `PENDING`, `ON_HOLD`.

### Assets

Asset `id` is a cuid string. Serialized shape ([`serializeAsset`](../app/api/v1/_serializers.ts)):

```json
{
  "id": "clx…",
  "asset_tag": "LT-0007",
  "name": "Dev Laptop 07",
  "type": "LAPTOP",
  "status": "IN_USE",
  "serial": "SN123",
  "model": "…", "manufacturer": "…", "location": "HQ",
  "ip_address": "10.0.0.7", "os": "Ubuntu 24.04",
  "owner": { "id": "…", "name": "…", "email": "…" },
  "created_at": "…", "updated_at": "…"
}
```

**`POST /assets` body:** `name` (required), `type` (default `SERVER`),
`status` (default `IN_USE`), plus optional `assetTag`, `serial`, `model`,
`manufacturer`, `location`, `ipAddress`, `os`, `externalId`, `syncSourceId`.

**`PATCH /assets/{id}` body:** any of `name`, `type`, `status`, `location`,
`ipAddress`, `os`, `ownerId` (the last four nullable).

Asset type and status enums are defined in [`lib/constants.ts`](../lib/constants.ts)
(`ASSET_TYPES`: `SERVER`, `WORKSTATION`, `LAPTOP`, `NETWORK`, `SOFTWARE`, `MOBILE`,
`PRINTER`, `VM`, `CLOUD`, `SERVICE`, `MONITOR`, `PHONE`; `ASSET_STATUSES`: `IN_USE`,
`IN_STOCK`, `MAINTENANCE`, `RETIRED`, `DISPOSED`).

### Services

`GET /services` returns all services (no pagination), each with its SLA and category:

```json
{
  "data": [
    {
      "id": "svc_…",
      "name": "Email",
      "description": "…",
      "status": "OPERATIONAL",
      "criticality": "HIGH",
      "category": "Communications",
      "sla": { "name": "Gold", "response_mins": 30, "resolve_mins": 240 }
    }
  ]
}
```

`category` is the category name (or `null`); `sla` is `null` when no SLA is attached.

---

## curl examples

The seed data ([`prisma/seed.ts`](../prisma/seed.ts)) creates a demo token named
**"Demo integration token"** owned by `admin@servio.dev` with scopes `read,write`:

```
servio_demo_pat_0123456789abcdef
```

> Development only. This token exists purely to make the API explorable after
> seeding — never rely on it in production.

```bash
BASE=http://localhost:3000/api/v1
TOKEN=servio_demo_pat_0123456789abcdef

# API index (no auth)
curl -s $BASE

# List open, high-priority tickets, page 1
curl -s "$BASE/tickets?status=open&priority=HIGH&per_page=10" \
  -H "Authorization: Bearer $TOKEN"

# Get one ticket
curl -s "$BASE/tickets/1" -H "Authorization: Bearer $TOKEN"

# Create a ticket
curl -s -X POST "$BASE/tickets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"VPN is down","type":"INCIDENT","priority":"HIGH"}'

# Transition a ticket (agent token)
curl -s -X PATCH "$BASE/tickets/1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"IN_PROGRESS"}'

# Search assets
curl -s "$BASE/assets?type=LAPTOP&q=dev" -H "Authorization: Bearer $TOKEN"

# List services and their SLAs
curl -s "$BASE/services" -H "Authorization: Bearer $TOKEN"
```

---

## Internal (non-`/api/v1`) endpoints

These routes exist but are **not** part of the public REST API. They are used by the
app UI, authenticate via the **session cookie** (not Bearer tokens), and are not
versioned or guaranteed stable:

| Route | Purpose | File |
| --- | --- | --- |
| `GET /api/search?q=…` | Global spotlight search across tickets, problems, changes, assets, people, services | [`app/api/search/route.ts`](../app/api/search/route.ts) |
| `GET /api/export?type=…` | CSV export. `type=tickets` (AGENT+) exports the ticket list; `type=audit` (ADMIN, honours the viewer's filters) exports the audit log. Returns a `text/csv` download. | [`app/api/export/route.ts`](../app/api/export/route.ts) |
| `POST /api/files/upload` | Attachment upload | [`app/api/files/upload/route.ts`](../app/api/files/upload/route.ts) |
| `GET /api/files/{id}` | Attachment download | [`app/api/files/[id]/route.ts`](../app/api/files/[id]/route.ts) |
| `POST /api/assistant/chat` | Console **Sable** streaming chat turn (`AGENT`+). Consumes the assistant-ui / `useChat` `messages[]` body (plus `conversationId` and optional `context`), rebuilds history server-side from the DB, and streams the reply as an AI SDK UI message stream (`toUIMessageStreamResponse`; the `claude-code` provider is buffered into one uniform stream). `propose_*` tool calls ride back as message metadata for the approve-first cards. | [`app/api/assistant/chat/route.ts`](../app/api/assistant/chat/route.ts) |
| `GET` / `DELETE /api/assistant/chat/{conversationId}/stream` | Console **Sable** running answers (`AGENT`+, own conversations only). `GET` rejoins an answer still streaming (replay so far, then live; `204` when none runs), `DELETE` is the Stop button (`204` stopped, `404` nothing of yours running). The POST run outlives its request; see [ai.md](ai.md#the-streaming-route). | [`app/api/assistant/chat/[id]/stream/route.ts`](../app/api/assistant/chat/[id]/stream/route.ts) |
| `POST /api/portal/assistant` | Portal self-service **Sable** turn (`USER`-scoped, ephemeral — the assistant-ui runtime holds the transcript). Consumes the assistant-ui / `useChat` `messages[]` body and streams the reply as an AI SDK UI message stream (same engine as the console); `propose_*` drafts stream as tool results the portal renders as confirm-to-create ticket/service/comment cards (confirmed via the create endpoint below). | [`app/api/portal/assistant/route.ts`](../app/api/portal/assistant/route.ts) |
| `POST /api/portal/assistant/create` | Confirms and creates the portal assistant's proposed ticket/service/comment. | [`app/api/portal/assistant/create/route.ts`](../app/api/portal/assistant/create/route.ts) |

Do not build integrations against these — use `/api/v1`.
