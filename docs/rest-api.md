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
2. Enter a name, the **owner** (default: you) and optionally an **expiry date**,
   then choose the **scopes**: a preset (read only, full write, admin) or
   **Custom** with an access level per resource (see [Scopes](#scopes)), and click
   **Generate token**.
3. **Copy the token immediately** — the full value is shown exactly once. Only a
   short prefix and a bcrypt hash are stored, so it cannot be recovered later.

Under the hood ([`createApiToken`](../lib/actions/tokens.ts)):

| Property | Value |
| --- | --- |
| Raw token format | `servio_pat_` + `nanoid(32)` |
| Stored `prefix` | first **18** chars of the raw token (`raw.slice(0, 18)`) |
| Stored `tokenHash` | `bcrypt.hash(raw, 10)` — the raw token is never persisted |
| Owner | the account picked as owner (`userId`), default the creating admin; must be active |
| Scopes | a preset or a custom selection (see [Scopes](#scopes)), normalised and stored as a comma-separated string; `admin`, `import:write` and `kb:publish` only for an ADMIN owner |
| Expiry | optional date: valid through the end of that day (UTC), at most 3650 days ahead; empty = never expires |

**Tokens for service accounts.** A token acts as its owner, with the owner's
role, so an integration should get its own account (e.g. an AGENT user for a
monitoring integration) and a token issued to it by an admin, instead of a token
of a person. The table lists every token with its owner and expiry; an expired
token is marked and refused like a revoked one. Creating a token for someone
else is audited with the owner, the scopes and the expiry (`ApiToken`, "Created API
token … for … with scopes …"; `meta.scopes` lists them). The rules are in
[`lib/token-rules.ts`](../lib/token-rules.ts).

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

A token carries **resource scopes**, **legacy scopes**, or both. The catalog and
every rule below live in [`lib/api-scopes.ts`](../lib/api-scopes.ts); the API index
(`GET /api/v1`) lists the scopes and the [OpenAPI spec](#openapi-spec) names the
scope of every operation.

**Resource scopes** grant one resource, derived from the route groups. A resource
`write` also grants that resource's `read`.

| Scope | Endpoints |
| --- | --- |
| `tickets:read` / `tickets:write` | `/tickets/**`: tickets, comments, attachments, lookup and resolve by external reference |
| `recurring:read` / `recurring:write` | `/recurring-tickets/**` |
| `problems:read` / `problems:write` | `/problems/**`: problems, transitions, comments, attachments |
| `changes:read` / `changes:write` | `/changes/**`: changes, transitions, approvals, comments, attachments |
| `cmdb:read` / `cmdb:write` | `/assets/**` (incl. relations, attachments), `/services`, `/licenses/**` (incl. seats, attachments), `/vendors/**` |
| `kb:read` / `kb:write` | `/articles/**` |
| `kb:publish` | setting `status` on `PUT /articles/ref/{ref}` (publish or retire without the review). Privileged: includes `kb:write` and `kb:read`; ADMIN owners only |
| `catalog:read` / `catalog:write` | `/categories/**` |
| `directory:read` | `/groups`, `/users` (lookups, read only) |
| `import:write` | `/import/**` and the history fields of uploads. Privileged: ADMIN owners only |

**Legacy scopes** keep exactly the rights they always had, so existing tokens work
unchanged:

| Scope | Grants |
| --- | --- |
| `read` | every `*:read` |
| `write` | every `*:write` except the privileged `import:write` and `kb:publish` |
| `admin` | everything, incl. `import:write` and `kb:publish` |

The UI ([`token-scope-picker.tsx`](../components/settings/token-scope-picker.tsx))
offers the presets **Read only** (`read`), **Full write** (`read,write`) and
**Admin** (`read,write,admin`), or **Custom**: per resource *no access*, *read* or
*read & write*; the knowledge base adds *read, write & publish*. [`tokenScopes`](../lib/token-rules.ts) normalises a custom selection
(known scopes only, catalog order, no scope another one already grants, at least
one). A token owner that is not an ADMIN cannot hold `admin`, `import:write` or `kb:publish`.

The link between a ticket and a problem or assets lives on the ticket, so a `tickets:write`
token can set `problem_id` and `asset_ids` on tickets without any `problems:*` or `cmdb:*` scope.

Example: a monitoring integration that opens and resolves tickets needs only
`tickets:write`. It cannot create changes, edit the CMDB or the knowledge base.

**Enforcement.** Every handler declares the resource scope it needs:
`guard(req, "tickets:write")` (or `agentGuard`, which also requires an agent
owner). The guard applies the rate limit (`429`), returns `401` for an invalid
token and `403` when the token lacks the scope; the error carries
`details.required_scope`. [`tests/unit/api-route-scopes.test.ts`](../tests/unit/api-route-scopes.test.ts)
enumerates every `/api/v1` route handler and asserts it is refused without scopes
with exactly the scope [`requiredScope`](../lib/api-scopes.ts) names for its path
and method (the route group's resource; `read` for `GET`, `write` otherwise), that
it passes with only that scope, and that the OpenAPI spec documents it. A new route
group fails the test until it is added to `RESOURCE_BY_SEGMENT`.

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
agent data and cannot be enumerated by a plain user token. The same holds for
**changes, problems and the lookups** (`/categories`, `/groups`, `/users`).
Ticket comments follow the ticket rule: a `USER` token reads the public replies of
its own tickets and cannot write.

When an agent sets `assigneeId` on ticket create/update, the assignee is validated
(must be an active `AGENT` who — if the ticket has a group — belongs to that group);
an invalid assignee returns `422`, not a `500`.

### Revoking a token

Revoke from the same **Settings › API Tokens** page. [`revokeApiToken`](../lib/actions/tokens.ts)
sets `revoked = true`. Only admins manage tokens, and they may revoke any, also
one issued to a service account. Revoked tokens are excluded from authentication
immediately.

---

## Base URL & versioning

| | |
| --- | --- |
| Base path | `/api/v1` |
| Current version | `1.0.0` (see `GET /api/v1`) |
| Content type | `application/json` (uploads: `multipart/form-data`; downloads: the file's own type) |
| Runtime | Node.js (`runtime = "nodejs"`); list/detail routes are `dynamic = "force-dynamic"` |
| CORS | Default **closed**: no `Access-Control-*` headers are emitted unless `API_CORS_ORIGIN` is set to an explicit origin (never `*`); when set, methods `GET, POST, PUT, PATCH, DELETE, OPTIONS`, allowed headers `Authorization, Content-Type`. Every route except `/openapi` implements `OPTIONS` (preflight → `204`). `GET /openapi` is the exception: it always sends `Access-Control-Allow-Origin: *`. |
| Session | `/api/v1` is a public path in the session middleware ([`lib/route-guard.ts`](../lib/route-guard.ts)), so it never needs a cookie; only the Bearer token authenticates. |

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
| `400` | Malformed JSON body (`POST` / `PATCH`) |
| `401` | Missing or invalid token |
| `403` | Token lacks the required scope (`details.required_scope` names it), or is a non-agent hitting an agent-only resource (`/assets`, `/services`) |
| `404` | Resource not found (or hidden from a non-agent); a non-numeric ticket id is also `404` |
| `409` | A closed or cancelled ticket refusing a new file; illegal ticket status transition, a merged ticket (only `CANCELLED` is allowed), or a request awaiting approval (only cancelling is allowed) |
| `413` | Upload larger than `MAX_UPLOAD_MB` (or cut short by the server's request body limit, see [Attachments](#attachments)) |
| `415` | Upload not `multipart/form-data`, or a file type / extension / content not on the allow-list |
| `422` | Zod validation failed, or an invalid `assigneeId` (`details` holds field errors) |
| `429` | Rate limit exceeded — a `Retry-After` header is returned |
| `503` | Maintenance mode is active: the middleware answers every `/api/*` request except `/api/auth` and `/api/maintenance` with `{ "error": "maintenance", "endsAt": … }` and a `Retry-After` header. Bearer clients carry no admin session, so they are refused until the window ends ([`proxy.ts`](../proxy.ts), [`lib/maintenance-rules.ts`](../lib/maintenance-rules.ts)) |

The API is rate-limited per token (falling back to client IP) with an in-memory
sliding window ([`lib/rate-limit.ts`](../lib/rate-limit.ts)). The key is the first 18
characters of the presented token, or the client IP (`X-Forwarded-For`, then
`X-Real-IP`) when no Bearer header is sent; it is checked before the token is
verified, on every guarded route (not on `/` or `/openapi`). The default is `120`
requests per `60000` ms. A `429` carries `Retry-After` (seconds) and the body
`{ "error": { "message": "Rate limit exceeded. Slow down and retry later." } }`. Limits
are per-process and env-tunable (`API_RATE_LIMIT`, `API_RATE_WINDOW_MS`) — see the
multi-instance caveat in [deployment.md](./deployment.md). Login is separately throttled with failed-attempt
lockout + backoff. Token creation/revocation is **ADMIN-only**.

---

## Pagination, filtering & sorting

Pagination applies to every list endpoint except `GET /services`, `/services/{id}/impact`, `/assets/{id}/services`, `/categories`, `/groups` and `/assets/{id}/relations` (those return everything) via
[`paginate`](../lib/api.ts):

| Param | Default | Bounds |
| --- | --- | --- |
| `page` | `1` | `>= 1` |
| `per_page` | `25` | `1`–`100` (clamped) |

**Filtering** is per-endpoint (only the params below exist — anything else is ignored):

| Endpoint | Filters |
| --- | --- |
| `GET /tickets` | `status` (exact, or the special value `open` → any open status), `priority`, `type`, `q` (substring match on `title`); exact: `import_ref`, `external_ref` (every ticket that carried the key, open or resolved) |
| `GET /assets` | `type`, `status`, `q` (substring match across `name`, `assetTag`, `serial`); exact: `serial`, `asset_tag`, `ip_address`, `mac_address`, `import_ref`, `owner_id`, `group_id`, `updated_since` |
| `GET /services` | `q` (substring match on `name` or `code`); exact: `status`, `criticality`, `code`, `import_ref` |

**Sorting is fixed** (not client-configurable): tickets by `updatedAt` descending,
assets by `name` ascending, services by `name` ascending.

---

## Endpoint reference

Paths are relative to `/api/v1`. "Scope" is the resource scope required by the
handler (`read` / `write` of the resource named in the row, see [Scopes](#scopes));
the legacy `read` / `write` / `admin` scopes satisfy them as described there.

| Method | Path | Description | Scope |
| --- | --- | --- | --- |
| `GET` | `/` | API index: name, version, and resource links. **No auth.** | — |
| `GET` | `/openapi` | OpenAPI 3.1 spec (JSON) — see [OpenAPI spec](#openapi-spec). **No auth.** | — |
| `GET` | `/health` | Liveness, maintenance mode and (with a token) the running version — see [Health](#health). **No auth needed**, also during maintenance. | any token for `version` |
| `GET` | `/tickets` | List tickets (paginated, filterable). Non-agents see only their own. | `tickets:read` |
| `POST` | `/tickets` | Create a ticket (`source = API`). | `tickets:write` |
| `GET` | `/tickets/{id}` | Get one ticket by numeric id. | `tickets:read` |
| `PATCH` | `/tickets/{id}` | Update a ticket (agents only). Enforces status-transition rules + SLA clock. | `tickets:write` |
| `GET` | `/tickets/ref/{ref}` | The ticket carrying an external reference: the open one, else the most recent (see [Monitoring dedup](#monitoring-dedup-external-reference)). | `tickets:read` |
| `POST` | `/tickets/ref/{ref}/resolve` | Resolve the open ticket carrying an external reference (monitoring recovery). Agent tokens only. | `tickets:write` |
| `GET` | `/assets` | List assets (paginated, filterable). Agent tokens only. | `cmdb:read` |
| `POST` | `/assets` | Create an asset. Agent tokens only. | `cmdb:write` |
| `GET` | `/assets/{id}` | Get one asset by id (cuid string). Agent tokens only. | `cmdb:read` |
| `PATCH` | `/assets/{id}` | Update any asset field. Agent tokens only. | `cmdb:write` |
| `GET` / `PUT` | `/assets/ref/{ref}` | Read / upsert an asset by its origin reference (for syncs). | `cmdb:read` / `cmdb:write` |
| `GET` | `/assets/{id}/services` | The services an outage of the asset hits (direct and transitive). | `cmdb:read` |
| `GET` / `POST` | `/assets/{id}/relations` | List / add dependency edges. | `cmdb:read` / `cmdb:write` |
| `DELETE` | `/assets/{id}/relations/{relation_id}` | Remove an edge. | `cmdb:write` |
| `GET` / `POST` | `/vendors` | List / create vendors (writes: MANAGER+). | `cmdb:read` / `cmdb:write` |
| `GET` / `PATCH` / `DELETE` | `/vendors/{id}` | Get / edit / delete a vendor. | `cmdb:read` / `cmdb:write` |
| `GET` / `PUT` | `/vendors/ref/{ref}` | Get / upsert a vendor by its origin reference. | `cmdb:read` / `cmdb:write` |
| `GET` / `POST` | `/contracts` | List / create vendor contracts (writes: MANAGER+). | `cmdb:read` / `cmdb:write` |
| `GET` / `PATCH` / `DELETE` | `/contracts/{id}` | Get / edit / delete a contract. | `cmdb:read` / `cmdb:write` |
| `GET` / `PUT` | `/contracts/ref/{ref}` | Get / upsert a contract by its origin reference. | `cmdb:read` / `cmdb:write` |
| `GET` / `POST` | `/catalog-items` | List / create service catalog items with their request forms (writes: MANAGER+). | `catalog:read` / `catalog:write` |
| `GET` / `PATCH` / `DELETE` | `/catalog-items/{id}` | Get / edit / delete a catalog item. | `catalog:read` / `catalog:write` |
| `GET` / `PUT` | `/catalog-items/ref/{ref}` | Get / upsert a catalog item by its origin reference. | `catalog:read` / `catalog:write` |
| `GET` / `POST` | `/change-templates` | List / create change templates (standard changes; writes: MANAGER+, HIGH-risk standard templates: ADMIN). | `catalog:read` / `catalog:write` |
| `GET` / `PATCH` / `DELETE` | `/change-templates/{id}` | Get / edit / delete a change template. | `catalog:read` / `catalog:write` |
| `GET` / `PUT` | `/change-templates/ref/{ref}` | Get / upsert a change template by its origin reference. | `catalog:read` / `catalog:write` |
| `GET` / `POST` | `/licenses` | List / create software licenses (writes: MANAGER+). | `cmdb:read` / `cmdb:write` |
| `GET` / `PATCH` | `/licenses/{id}` | Get / edit a license. | `cmdb:read` / `cmdb:write` |
| `POST` | `/licenses/{id}/assignments` | Assign a seat to an asset and/or user. | `cmdb:write` |
| `DELETE` | `/licenses/{id}/assignments/{assignment_id}` | Release a seat. | `cmdb:write` |
| `GET` / `POST` | `/recurring-tickets` | List / create recurring ticket schedules (writes: MANAGER+). | `recurring:read` / `recurring:write` |
| `GET` / `PATCH` / `DELETE` | `/recurring-tickets/{id}` | Get / edit, pause or resume / delete a schedule. | `recurring:read` / `recurring:write` |
| `GET` / `POST` | `/services` | List services (not paginated) / create one with its CIs and dependencies (MANAGER+). Agent tokens only. | `cmdb:read` / `cmdb:write` |
| `GET` / `PATCH` / `DELETE` | `/services/{id}` | Get (with `assets`, `depends_on`, `used_by`) / edit / delete a service (writes: MANAGER+; delete refused while referenced). | `cmdb:read` / `cmdb:write` |
| `GET` | `/services/{id}/impact` | The services that go down with this one. | `cmdb:read` |
| `GET` / `PUT` | `/services/ref/{ref}` | Get / upsert the service with this origin reference (MANAGER+, idempotent). | `cmdb:read` / `cmdb:write` |
| `GET` / `POST` | `/articles` | List (paginated, no bodies) / create knowledge articles. Agent tokens only. | `kb:read` / `kb:write` |
| `GET` / `PATCH` / `DELETE` | `/articles/{id}` | Get / edit / delete an article. | `kb:read` / `kb:write` |
| `POST` | `/articles/{id}/transitions` | Move an article along its lifecycle (publishing: MANAGER+, not the author). | `kb:write` |
| `GET` / `PUT` | `/articles/ref/{ref}` | Get / upsert the article with this origin reference (setting `status`: `kb:publish` scope + ADMIN). | `kb:read` / `kb:write` |
| `GET` | `/tickets/{id}/comments` | A ticket's thread (oldest first, paginated). Users: public replies of their own tickets. | `tickets:read` |
| `POST` | `/tickets/{id}/comments` | Add a reply or internal note (agents who may act on the ticket). | `tickets:write` |
| `GET` | `/changes` | List changes (paginated, filterable, full-text `q`). Agent tokens only. | `changes:read` |
| `POST` | `/changes` | Create a change (always `DRAFT`). Agent tokens only. | `changes:write` |
| `GET` | `/changes/{id}` | Get one change with approvals and affected CIs. | `changes:read` |
| `PATCH` | `/changes/{id}` | Edit fields, plans, window, problem link (not the status). | `changes:write` |
| `POST` | `/changes/{id}/transitions` | Move along the lifecycle, incl. submit for approval. | `changes:write` |
| `POST` | `/changes/{id}/approvals/{approval_id}` | Record a CAB decision. | `changes:write` |
| `GET`/`POST` | `/changes/{id}/comments` | List / add comments. | `changes:read` / `changes:write` |
| `GET` | `/problems` | List problems (paginated, filterable, full-text `q`). Agent tokens only. | `problems:read` |
| `POST` | `/problems` | Create a problem. Agent tokens only. | `problems:write` |
| `GET` | `/problems/{id}` | Get one problem with linked tickets and changes. | `problems:read` |
| `PATCH` | `/problems/{id}` | Edit fields, root cause, workaround (not the status). | `problems:write` |
| `POST` | `/problems/{id}/transitions` | Move along the lifecycle. | `problems:write` |
| `GET`/`POST` | `/problems/{id}/comments` | List / add comments. | `problems:read` / `problems:write` |
| `GET` | `/categories` | Categories, to resolve a `category_id`. Agent tokens only. | `catalog:read` |
| `POST` | `/categories` | Create a category (MANAGER+). | `catalog:write` |
| `GET` / `PATCH` | `/categories/{id}` | Get / edit a category (edit: MANAGER+). | `catalog:read` / `catalog:write` |
| `GET` | `/groups` | Groups with member ids. Agent tokens only. | `directory:read` |
| `GET` | `/users` | User lookup, minimal fields (`q`, `role`, `active`). Agent tokens only. | `directory:read` |
| `GET` / `POST` | `/{entity}/{id}/attachments` | `entity` = `tickets`, `changes`, `problems`, `assets` or `licenses`: list a record's files (paginated) / upload one (`multipart/form-data`). See [Attachments](#attachments). | `<resource>:read` / `<resource>:write` of the parent (`assets`, `licenses`: `cmdb`) |
| `GET` / `DELETE` | `/{entity}/{id}/attachments/{attachment_id}` | Download the file (the raw bytes) / remove it and its stored blob. | `<resource>:read` / `<resource>:write` of the parent (`assets`, `licenses`: `cmdb`) |
| `POST` | `/import/tickets` | Import a historical ticket with its thread (see [History import](#history-import)). | `import:write` + ADMIN owner |
| `POST` | `/import/problems` | Import a historical problem with its thread. | `import:write` + ADMIN owner |
| `POST` | `/import/changes` | Import a historical change with its thread. | `import:write` + ADMIN owner |
| `PUT` | `/import/{tickets\|problems\|changes}/{import_ref}` | Create or bring an imported record up to date (update mode for re-runs, see [History import](#update-mode-for-re-runs)). | `import:write` + ADMIN owner |

There are no endpoints for releases yet. Whole records can be deleted for
articles, recurring ticket schedules, unreferenced services and the configuration
records MANAGER+ maintain (vendors, contracts, catalog items, change templates);
tickets, changes, problems and assets and licenses are not deleted through the API
(only their relations, license seats and attachments).

### Tickets

Ticket and asset request bodies were defined in `camelCase` (`assigneeId`) and
also accept the `snake_case` spelling used everywhere else (`assignee_id`): top-level
keys are translated before validation ([`lib/api-case.ts`](../lib/api-case.ts)).
Sending one field in both spellings with different values is a `422`.

Ticket `id` is a **numeric** id; the serializer also returns a human `ref`
(`INC-0001` / `REQ-0001`, from [`ticketRef`](../lib/constants.ts) and the ticket's
stored `prefix`). Field names in
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
  "group_id": null,
  "problem_id": null,
  "change_id": null,
  "import_ref": null,
  "external_ref": null,
  "external_ref_open": false,
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
| `groupId` | string | the category's team | **agents only**; unknown ids return `422`. Without it, a category with a team (`group_id`) routes the ticket there |
| `externalRef` | string, 1–200 of `A-Z a-z 0-9 . _ : @ -`, starting with a letter or digit | — | **agents only** (a non-agent token gets `403`); monitoring dedup key, see below |
| `onDuplicate` | `return` \| `comment` | `return` | what a repeat with an open `externalRef` does |

For non-agent tokens, only `title`, `description`, `type`, `priority`, `impact`,
`urgency` are honored; all other fields fall back to defaults (an unknown
`requesterId`/`categoryId`/`serviceId` is still rejected with `422` before that
filtering). SLA response/resolve
deadlines are resolved from the service + priority at creation time. Agents may
pick a starting status, but only an **open** one (`NEW`, `OPEN`, `IN_PROGRESS`,
`PENDING`, `ON_HOLD`) — a ticket can't be born `RESOLVED`/`CLOSED`/`CANCELLED`,
which would skip breach stamping, automations and the survey pipeline (else `422`).

Routing on create: the ticket's group is `groupId`, else its category's team. An
`assigneeId` must be a member of that group (else `422`); without an assignee the
group's auto-assign strategy picks one, as for a ticket routed in the console.

**`PATCH /tickets/{id}` body** (agents only): `title` (min 3), `description`, `status`,
`priority`, `assigneeId` (nullable), `groupId` (nullable; unknown ids `422`),
`serviceId` (nullable; unknown ids `422`; on an open ticket a new service re-prices
the SLA deadlines like the console, see [SLA re-pricing](./modules.md)),
`problemId` / `changeId` (integer, `null`
unlinks; applied through the console's `setTicketProblem` / `setTicketChange`, so
only someone who may act on the ticket can link it, else `403`). The serialized
ticket carries `group_id`, `service_id`, `problem_id` and `change_id`. Changing `groupId` works as
re-routing in the console: an assignee who is not a member of the new group is
cleared (unless the same request sets `assigneeId`, which must then be a member),
and the group's auto-assign strategy picks a new one. Changing `status`:

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
- `RESOLVED`, `CLOSED` and `CANCELLED` release the ticket's external reference
  (see below), so the next alert with that key opens a new ticket.

#### Monitoring dedup (external reference)

Monitoring integrations (Zabbix, Wazuh, …) call the API per alert. With an
`external_ref` — the alert's stable key, e.g. `zabbix:event:12345` or
`wazuh:rule:92206:host:pc-042` — repeated alerts land in **one open ticket**:

| Request | Answer |
| --- | --- |
| `POST /tickets` with an `external_ref` no open ticket carries | `201`, the new ticket, `meta.deduplicated: false` |
| `POST /tickets` with the `external_ref` of an open ticket | `200`, **that** ticket, `meta.deduplicated: true`; nothing else in the body is applied |
| … with `on_duplicate: "comment"` | the same, and the request's `description` (its `title` when empty) is added to the open ticket as an **internal** note through the same path as `POST /tickets/{id}/comments` (`meta.comment`); when the token's owner may not write to that ticket the answer is that endpoint's `403`, with the ticket in `error.details.ticket` |
| `POST /tickets/ref/{ref}/resolve` | resolves the open ticket (`200`); `404` when none is open |
| `GET /tickets/ref/{ref}` | the open ticket, else the most recent one that carried the key; `404` if none |
| `GET /tickets?external_ref=…` | every ticket that ever carried the key |

The key is unique among **open** tickets (`NEW`, `OPEN`, `IN_PROGRESS`, `PENDING`,
`ON_HOLD`). Concurrent POSTs with the same new key (Wazuh fires integrations in
parallel) end in one ticket: the database's unique index picks the single
winner and the others answer `200` with it. Once the ticket reaches `RESOLVED`,
`CLOSED` or `CANCELLED` — through this endpoint, `PATCH`, the console, a macro,
an automation or a merge — the key is released and the next POST opens a new
ticket; the old one keeps `external_ref` as history (`external_ref_open: false`).
Reopening a resolved ticket does **not** reclaim the key (a newer ticket may
hold it by then): a reopened alert ticket is handled as a human ticket.

The resolve body is optional: `resolution_note`, `resolution_code`
(`RESOLUTION_CODES`), `internal` (default `true`: the note is an internal
comment; `false` makes it the public resolution reply). It runs the console's
resolution action as the token's owner (see [How the ITSM endpoints enforce the
console's rules](#how-the-itsm-endpoints-enforce-the-consoles-rules)): the
configured workflow map and role gates (a refused move is `409`), the merge and
approval rules, SLA stamping (`resolvedAt`, `resolveBreached`, a paused clock is
resumed first), the resolution comment and mail, and automations. Only someone
who may act on the ticket can resolve it (`403`).

Ticket status enum: `NEW`, `OPEN`, `IN_PROGRESS`, `PENDING`, `ON_HOLD`, `RESOLVED`,
`CLOSED`, `CANCELLED`. Open statuses (matched by `?status=open`): `NEW`, `OPEN`,
`IN_PROGRESS`, `PENDING`, `ON_HOLD`.

### Assets

Asset `id` is a cuid string. Serialized shape ([`serializeAsset`](../app/api/v1/_serializers.ts)):

```json
{
  "id": "clx…", "asset_tag": "LT-0007", "name": "Dev Laptop 07", "type": "LAPTOP", "status": "IN_USE",
  "serial": "SN123", "model": "…", "manufacturer": "…",
  "location": "HQ", "location_ref": { "id": "…", "name": "Berlin HQ" },
  "ip_address": "10.0.0.7", "mac_address": "aa:bb:cc:dd:ee:01", "os": "Ubuntu 24.04",
  "cpu": "i5-12400T", "ram_gb": 16, "storage_gb": 512, "cost": 899, "purchase_date": "2024-05-01", "warranty_end": "2027-05-01",
  "notes": "…", "owner": { "id": "…", "name": "…", "email": "…" }, "group": { "id": "…", "name": "IT" },
  "external_id": null, "import_ref": "inventory:host:pc-042", "last_seen_at": "…",
  "created_at": "…", "updated_at": "…"
}
```

Asset request bodies use the camelCase field names (`ipAddress`); the snake_case
spelling (`ip_address`) is accepted too. Writable fields: `name`, `type`, `status`,
`assetTag`, `serial`, `model`, `manufacturer`, `location`, `locationId`, `ipAddress`,
`macAddress`, `os`, `cpu`, `ramGb`, `storageGb`, `cost`, `purchaseDate`, `warrantyEnd`
(`YYYY-MM-DD` or an ISO time), `notes`, `ownerId`, `groupId`, `lastSeenAt`. Text fields
are trimmed and an empty string is stored as `null`. Unknown `ownerId` / `groupId` /
`locationId` ids are a `422`; an asset tag or import reference that another asset
already uses is a `409`.

- **`POST /assets`:** `name` required, `type` (default `SERVER`), `status` (default
  `IN_USE`), any field above, plus `externalId`, `syncSourceId`, `importRef`.
- **`PATCH /assets/{id}`:** any field above; `null` clears a nullable one. Only
  values that actually change are written and audited; `meta.changed` lists them.
- **`GET /assets` filters:** `type`, `status`, `q` (substring of name, tag, serial),
  and exact matches for syncs: `serial`, `asset_tag`, `ip_address`, `mac_address`,
  `import_ref`, `owner_id`, `group_id`, `updated_since`.

#### Upsert by origin reference (for syncs)

`PUT /assets/ref/{ref}` is the entry point for an inventory sync. `{ref}` is the
asset's origin key, chosen by the caller, e.g. `inventory:host:pc-042` or
`glpi:computer:12` (1–200 characters: letters, digits and `. _ : @ -`; no `/`).
It is stored as `importRef` (unique).

- Unknown ref: the asset is created (`201`, `meta.created: true`); `name` is
  required, `type`/`status` default like `POST`.
- Known ref: only the fields sent are written (`200`, `meta.created: false`).
  Re-sending unchanged facts changes nothing and writes **no** audit row, so a
  sync can push its full state every run; `meta.changed` lists what did change.
- The body is **strict** (unknown field = `422`): in a sync a typo must fail
  loudly. Two syncs creating the same ref at once end in one asset.
- `GET /assets/ref/{ref}` reads it back.

#### Relations (CMDB graph)

- `GET /assets/{id}/relations`: the asset's edges in both directions
  (`direction`: `outgoing` when this asset is the source, `other` = the far end).
- `POST /assets/{id}/relations` `{ "target_id": "…", "type": "RUNS_ON" }` (`type`
  default `DEPENDS_ON`; `DEPENDS_ON`, `CONNECTS_TO`, `RUNS_ON`, `HOSTS`, `PART_OF`,
  `BACKS_UP`): through the console's `addAssetRelation` (no self-links, both ends
  must exist, an identical edge is kept, not duplicated).
- `DELETE /assets/{id}/relations/{relation_id}`: the edge must touch this asset,
  else `404`.

Asset type and status enums are defined in [`lib/constants.ts`](../lib/constants.ts)
(`ASSET_TYPES`: `SERVER`, `WORKSTATION`, `LAPTOP`, `NETWORK`, `SOFTWARE`, `MOBILE`,
`PRINTER`, `VM`, `CLOUD`, `SERVICE`, `MONITOR`, `PHONE`; `ASSET_STATUSES`: `IN_USE`,
`IN_STOCK`, `MAINTENANCE`, `RETIRED`, `DISPOSED`).

### Vendors & licenses

Agent tokens only; writes need a token owned by a **MANAGER or above** (the
console's rule for vendors, contracts and licenses; else `403`). License writes go
through the console's actions in `lib/actions/contracts.ts`; vendor and contract
writes follow [Managed configuration records](#managed-configuration-records).
Bodies are snake_case and strict.

- `GET /vendors` (`name` exact, `q`, `active`), `POST /vendors` `{ name, website?,
  email?, phone?, notes?, active?, import_ref? }` (names are unique: duplicate `409`
  with the existing `id`), `GET` / `PATCH` / `DELETE /vendors/{id}` (`active` to
  deactivate; fields left out keep their value; contracts and licenses of a
  deleted vendor stay, without a vendor), `GET` / `PUT /vendors/ref/{ref}`.
- Contracts: see [Contracts](#contracts).
- `GET /licenses` (`vendor_id`, `q`, `asset_id` / `user_id` = licenses assigned to
  it), `POST /licenses` `{ name, license_type (default PER_USER), seats (default 1),
  vendor_id?, contract_id?, owner_id?, expires_at? (YYYY-MM-DD), cost?, notes? }`,
  `GET` / `PATCH /licenses/{id}`. The serialized license carries `seats`,
  `used_seats`, `over_allocated` and its `assignments`.
- `POST /licenses/{id}/assignments` `{ asset_id?, user_id? }` (at least one)
  assigns a seat; a duplicate seat is refused (`409`); more seats than purchased
  are allowed and show as `over_allocated`. `DELETE
  /licenses/{id}/assignments/{assignment_id}` releases one.

### Recurring tickets

Schedules that create a ticket per occurrence (GLPI "recurrent items"; see the
Recurring tickets module in [modules.md](./modules.md)). Agent tokens only; writes
need a token owned by a **MANAGER or above** (else `403`) and run the console's
actions in `lib/actions/recurring-tickets.ts` as the token owner, so validation,
audit rows and `next_due_at` recomputation are the console's. Bodies are
snake_case and strict ([`lib/recurring-ticket-input.ts`](../lib/recurring-ticket-input.ts)).

- `GET /recurring-tickets` (`active` = `true` / `false`, `q` on name and title,
  `import_ref`), ordered by `next_due_at`.
- `POST /recurring-tickets` `{ name, title, frequency (DAILY | WEEKLY | MONTHLY |
  YEARLY), first_due_at, description?, type? (default REQUEST), priority?, impact?,
  urgency? (default MEDIUM), requester_id? (default: the token owner), assignee_id?,
  group_id?, category_id?, service_id?, interval? (default 1), timezone? (IANA,
  default UTC), create_before_days? (default 0), active? (default true),
  import_ref?, last_created_for? }` → `201`.
  - `first_due_at` is the due time of the first occurrence: wall-clock time in
    `timezone` (`2027-01-31T09:00`) or an ISO time with offset. Later occurrences
    keep that wall-clock time across DST; monthly/yearly dates past a month's end
    clamp to its last day (Jan 31 → Feb 28/29 → Mar 31).
  - `create_before_days` is `0`–`365`. It may be longer than one step (a weekly
    check created 30 days ahead): every occurrence whose window is open gets its
    own ticket. At most 31 occurrences may be open at once, so short steps are
    capped (every day: `30`; every week: `216`); else `422` on `create_before_days`.
  - **History import:** `import_ref` (e.g. `glpi:ticketrecurrent:7`, unique) makes
    re-runs idempotent: an existing ref answers `200` with `meta.created: false`
    and changes nothing. `last_created_for` (ISO with offset) is the due time of the
    last occurrence the source system already created, so it is not created again.
  - The first `next_due_at` is the first occurrence that is not due yet (and after
    `last_created_for`); occurrences in the past are never created retroactively.
- `GET /recurring-tickets/{id}`; `PATCH /recurring-tickets/{id}` (any field above
  except `import_ref` / `last_created_for`; left-out fields keep their value, `null`
  clears an id, `requester_id: null` = the schedule's creator). A changed recurrence
  (`frequency`, `interval`, `timezone`, `first_due_at`, `create_before_days`) or
  `active: true` after a pause recomputes `next_due_at`; `active: false` pauses.
  When only `timezone` changes, `first_due_at` keeps its wall-clock time.
- `DELETE /recurring-tickets/{id}` → `{ id, deleted: true }`; tickets the schedule
  already created stay.

A schedule serializes its template and recurrence plus `next_due_at` (next
occurrence still to create), `next_create_at` (when its ticket will be created),
`last_created_for`, `last_ticket_id`, `last_error` (why the last attempt failed),
`import_ref`, `created_by_id`. Generated tickets have `source = RECURRING` and the
occurrence's due time as their due date.

### Knowledge articles

Agent tokens only. Bodies are sent as Markdown (default) or HTML
(`body_format: "html"`) and stored as sanitised HTML, like articles written in the
console; responses carry the stored form (`body_format` is `html`). A body with no
readable text left after sanitising is a `422`.

An article: `id`, `slug`, `title`, `excerpt`, `body`, `body_format`, `status`
(`DRAFT`/`REVIEW`/`PUBLISHED`/`RETIRED`), `visibility` (`INTERNAL` = agents only,
`PUBLIC` = also the portal), `category_id`, `author_id`, `approved_by_id`,
`import_ref`, `views`, `published_at`, `approved_at`, `created_at`, `updated_at`.
Lists leave out `body` and `body_format`.

- **`GET /articles`** — newest change first, paginated. Filters: `status`,
  `visibility`, `category_id`, `import_ref`, `updated_since` (ISO time), `q` (title
  or excerpt).
- **`POST /articles`** — `title` (3–160), `body`, optional `body_format`, `excerpt`
  (≤ 300), `visibility` (default `INTERNAL`), `category_id`, `import_ref`. Always a
  `DRAFT` authored by the token's owner. An `import_ref` already in use is a `409`
  with the article's `id`.
- **`PATCH /articles/{id}`** — any of the fields above except `import_ref`; only
  the fields sent change, `null` clears `excerpt`/`category_id`. Every edit is a new
  revision; a `PUBLISHED` article edited by a token below MANAGER goes back to
  `REVIEW` (and the managers are notified), as in the console.
- **`DELETE /articles/{id}`** — removes the article with its revisions and links.
- **`POST /articles/{id}/transitions`** `{ "to": "REVIEW" }` — runs the console's
  status action: the moves of the article page (`409` otherwise), and publishing
  needs a MANAGER+ owner who is not the author (`403`).

**Keeping an FAQ in step with a source — `PUT /articles/ref/{ref}`.** `ref` has
the charset of `external_ref` (e.g. `faq:vpn-setup`). The body is the article's
full desired content: `title`, `body` (required), `body_format`, `excerpt`,
`visibility`, `category_id`, `status`. A new ref creates the article (`201`,
`DRAFT` unless `status` says otherwise); an existing one gets the fields that
differ as one new revision (`200`). Sending the same content again writes nothing
— no revision, no audit row; `meta.changed` lists what changed (empty when
nothing did), `meta.created` says whether it was new. Fields left out keep their
value.

Setting `status` publishes (or retires) without the review, so it needs the
`kb:publish` scope (or `admin`) and a token owned by an ADMIN (else `403`); a publish stamps the
token's owner as approver. Without `status`, an existing article keeps its status,
except that a `PUBLISHED` one changed by a token below MANAGER goes back to
`REVIEW`.

### Services

Services are writable CMDB objects with a service number, supporting CIs and
service-to-service dependencies; the model and the impact rules are described in
[services.md](./services.md). Every endpoint needs an agent token; writes need a
token owned by a **MANAGER or ADMIN** (else `403`), like categories. Bodies are
snake_case and strict (an unknown field is a `422`), from
[`lib/api-service-input.ts`](../lib/api-service-input.ts). Every write is audited.

`GET /services` returns all services (no pagination), each with its ids, its
category name and its SLA targets:

```json
{
  "data": [
    {
      "id": "svc_…",
      "code": "S-01",
      "name": "Email",
      "description": "…",
      "status": "OPERATIONAL",
      "criticality": "HIGH",
      "icon": "Mail",
      "category": "Communications",
      "category_id": "cat_…",
      "owner_id": "usr_…",
      "sla_id": "sla_…",
      "group_id": "grp_…",
      "sla": { "name": "Gold", "response_mins": 30, "resolve_mins": 240 },
      "import_ref": "catalog:mail",
      "created_at": "2026-11-01T08:00:00.000Z",
      "updated_at": "2026-11-09T10:00:00.000Z"
    }
  ]
}
```

`category` is the category name (or `null`); `sla` is `null` when no SLA is
attached. Filters: `status`, `criticality`, `code`, `import_ref` (exact) and `q`
(name or code).

`GET /services/{id}` (and `GET /services/ref/{ref}`) adds the links:

```json
{
  "data": {
    "id": "svc_…", "code": "S-01", "name": "Email", "…": "…",
    "assets": [{ "id": "ast_…", "name": "mail-01", "type": "SERVER", "status": "IN_USE", "import_ref": null }],
    "depends_on": [{ "service_id": "svc_dir", "code": "S-02", "name": "Directory", "status": "OPERATIONAL", "criticality": "CRITICAL", "note": "sign-in" }],
    "used_by": []
  }
}
```

**Writable fields** (`POST /services`, `PATCH /services/{id}`, `PUT /services/ref/{ref}`):
`name` (2-120, unique), `code` (1-32 of letters, digits and `. _ / -`, unique;
`null` clears), `description`, `status` (`SERVICE_STATUSES`), `criticality`
(`CRITICALITIES`), `icon`, `category_id`, `owner_id`, `sla_id`, `group_id` (all
nullable), `asset_ids` (the supporting CIs; **replaces the set**, `[]` unlinks all)
and `depends_on` (the services it needs; **replaces the set**). A `depends_on` entry
is `{ "service_id": "…" }` or `{ "service_ref": "<import_ref>" }` (exactly one), with
an optional `note`. `POST` also takes `import_ref`. `PATCH` changes only the fields
sent. Responses carry the detail view plus `meta.created` and `meta.changed` (the
fields that actually changed; an unchanged body writes nothing and no audit row).

**`PUT /services/ref/{ref}`** upserts by origin reference: it creates the service
(`201`, `name` required) when the ref is new and otherwise writes only the fields
sent (`200`). Re-sending the same facts is a no-op, so a sync can push its whole
service map on every run; because `depends_on` can name services by `service_ref`,
the map can be pushed in dependency order without knowing ids. Two runs creating
the same ref at once end as one create and one update.

**Refusals** carry `details.code`:

| Status | `details.code` | When |
| --- | --- | --- |
| `422` | `self_dependency` | `depends_on` names the service itself |
| `422` | `dependency_cycle` | the set would close a cycle; `details.cycle` is the path as `{ id, name }` |
| `422` | `unknown_reference` | an unknown category / owner / SLA / group / asset / `service_id` / `service_ref` |
| `422` | `duplicate_entry` | the same asset or service listed twice |
| `409` | `name_taken`, `code_taken`, `import_ref_taken` | the value is used by another service (`details.id`) |
| `409` | `service_in_use` | `DELETE` while tickets, catalog items, dependent services, status incidents, change templates, recurring tickets or freeze windows reference it; `details.references` counts them and `details.suggestion` is `{ "status": "RETIRED" }` |

`DELETE /services/{id}` removes an unreferenced service with its own CI links and
dependencies. Retire a referenced one instead (`PATCH` with `"status": "RETIRED"`).

**Impact.** `GET /services/{id}/impact` lists the services that go down with the
service; `GET /assets/{id}/services` the services an outage of the asset hits. Each
entry is `{ service_id, code, name, status, criticality, depth, direct, via }`,
nearest first: `depth` 0 runs on a failed CI (`direct` when it is the asked asset
itself), higher depths are dependency hops, and `via` (`{ kind: "asset" | "service",
id, name }`) is what it was reached through. The rules are in
[services.md](./services.md#impact).

### Health

`GET /health` is for load balancers, monitoring and update tooling. It needs no token and stays
reachable while maintenance mode blocks everything else:

```json
{ "data": { "status": "ok", "maintenance": false } }
```

`status` is `ok` while the app and its database answer; when the database does not, the answer is
`503` with `"status": "unavailable"`. `maintenance` is `true` while a blocking maintenance window
runs. Send any valid API token (any scope) to also get the running release, e.g. to check what an
update installed or what `SERVIO_VERSION` should say ([updates.md](./updates.md#compose-and-the-running-version)):

```json
{ "data": { "status": "ok", "maintenance": false, "version": "0.6.0" } }
```

Anonymous callers never see the version. A token that is sent but invalid gets `401`, like on
every other endpoint.

### How the ITSM endpoints enforce the console's rules

Changes, problems, ticket links and recurring tickets do not re-implement their business rules.
The handlers run the console's own server actions (`lib/actions/changes.ts`,
`lib/actions/problems.ts`, `lib/actions/tickets.ts`) **as the token's owner**:
[`lib/api-actor.ts`](../lib/api-actor.ts) puts the owner's id in an
`AsyncLocalStorage` scope that `getSessionUser()` in
[`lib/session.ts`](../lib/session.ts) consults before the Auth.js session. The
role and `isActive` are read from the user row on every call. So the transition
map and role gates, CAB seating and separation of duties, change freezes,
standard-template demotion, field locks after `CLOSED`/`CANCELLED`, required
custom fields and the audit trail (attributed to the token owner) behave exactly
as in the UI. Only `runAsApiActor` enters that scope, and only the `/api/v1`
handlers call it after `guard()` authenticated the token.

The actions report refusals as text; the API keeps it as `error.message` and maps
it to a status ([`refusalStatus`](../lib/api-itsm-input.ts)): "not found" `404`,
permission refusals `403`, invalid input `422`, everything else (workflow,
freeze, lock, concurrency) `409`.

Request bodies of these endpoints are `snake_case` like the responses and **strict**: an unknown field is a
`422`, so a typo like `rollback_plna` cannot silently drop a rollback plan.
Bodies are validated by the Zod schemas in
[`lib/api-itsm-input.ts`](../lib/api-itsm-input.ts), from which the OpenAPI
request schemas are generated. Text fields (`description`, comments) are plain
text; editing a description through the API replaces its rich-text version.

### Changes

Change `id` is numeric; `ref` is `CHG-0001`. Serialized shape
([`serializeChange`](../app/api/v1/_serializers.ts)):

```json
{
  "id": 8, "ref": "CHG-0008", "title": "Patch dc01", "description": "…",
  "type": "NORMAL", "status": "CLOSED", "risk": "LOW", "priority": "MEDIUM", "impact": "MEDIUM",
  "reason": "…", "implementation_plan": "…", "rollback_plan": "…",
  "outcome": "SUCCESSFUL", "closure_notes": "…", "cancel_reason": null,
  "custom_fields": {}, "assignee": { "id": "…", "name": "…", "email": "…" }, "created_by": { … },
  "group": { "id": "…", "name": "Infrastructure" }, "category": null,
  "problem_id": 5, "release_id": null, "template_id": null,
  "approvals": [{ "id": "…", "status": "APPROVED", "comment": "ok", "decided_at": "…", "approver": { … } }],
  "assets": [{ "id": "…", "name": "dc01", "type": "SERVER" }],
  "comment_count": 2,
  "planned_start": "…", "planned_end": "…", "actual_start": "…", "actual_end": "…",
  "created_at": "…", "updated_at": "…"
}
```

**`GET /changes` query:** `status` (a status, or `open` = not `CLOSED`/`REJECTED`/
`FAILED`/`CANCELLED`), `type`, `risk`, `assignee_id`, `group_id`, `category_id`,
`problem_id`, `updated_since` (ISO time), `q` (substring of title, description,
reason, both plans, closure notes and comment bodies), `page`, `per_page`. Sorted
by `updated_at` descending.

**`POST /changes` body:** `title` (min 3, required), `description`, `type`
(`STANDARD`/`NORMAL`/`EMERGENCY`, default `NORMAL`), `risk`, `priority`, `impact`
(default `MEDIUM`), `reason`, `implementation_plan`, `rollback_plan`,
`assignee_id`, `group_id`, `category_id`, `planned_start`/`planned_end` (ISO with
offset), `asset_ids` (affected CIs), `custom_fields` (`{ key: value }`). Always
created in `DRAFT`, through `createChange` (standard-type rule, window check,
required custom fields, unknown CI → `422`).

**`PATCH /changes/{id}` body:** any of `title`, `description`, `type`, `risk`,
`priority`, `impact`, `assignee_id`, `group_id`, `category_id` (the three nullable),
`reason`, `implementation_plan`, `rollback_plan` (nullable), `planned_start`,
`planned_end` (with `reschedule_reason` when an approved change's window moves, and
`justification` for an emergency change moving into a freeze), `problem_id`
(nullable). The edits are applied in a fixed order (details, fields with the
group before the assignee, plans, window, problem link), each through the action
that owns it. When one is refused, the earlier ones stay applied: the error's
`details` hold `field`, `applied` and the change as it now is. `status` is not
accepted here.

**`POST /changes/{id}/transitions` body:** `to` plus `outcome`, `closure_notes`,
`cancel_reason`, `justification` as the move needs them.

- `to: "APPROVAL"` submits a draft: plans and window required, freeze check (an
  `EMERGENCY` change may pass a freeze with a `justification`; the refusal then
  carries `details.needs_justification: true`), CAB seated and notified. A
  standard change from an active template is approved directly.
- `APPROVED` / `REJECTED` cannot be set by hand (`409`): the board decides through
  `POST /changes/{id}/approvals/{approval_id}` with `{ "decision": "APPROVED" |
  "REJECTED", "comment"? }`. Only the seated approver (or an admin) may decide, and
  never on a change they requested or own (`409`), unless an admin allowed
  self-approval (setting `CHANGE_SELF_APPROVAL`, see [modules.md](modules.md#approvals)).
  Then the requester or owner may decide their **own** seat: `comment` becomes
  required as the justification (`422` without it), their role must still fit the
  change's risk (`403`), and in `ALWAYS` mode their decision settles the board on its
  own. A client can tell a self-approval seat by comparing `approver.id` with the
  change's `created_by.id` and `assignee.id`.
- All other moves follow the configured transition map and role gates (`409` when
  not allowed). `IN_PROGRESS` stamps `actual_start`, closing stamps `actual_end`.
  `CLOSED`/`FAILED` need an `outcome` (`SUCCESSFUL`, `SUCCESSFUL_WITH_ISSUES`,
  `FAILED`, `ROLLED_BACK`), `CANCELLED` a `cancel_reason`.

Once `CLOSED` or `CANCELLED`, the change's fields are locked (`409`); comments and
the problem link stay editable, as in the console.

### Problems

`ref` is `PRB-0001`. The serialized problem has `id`, `ref`, `title`,
`description`, `status`, `priority`, `impact`, `root_cause`, `workaround`,
`custom_fields`, `assignee`, `group`, `category`, `tickets` (`id`, `ref`, `title`,
`status`), `changes` (`id`, `ref`, `title`, `status`), `comment_count`,
`resolved_at`, `created_at`, `updated_at`.

- **`GET /problems` query:** `status` (or `open` = not `RESOLVED`/`CLOSED`),
  `priority`, `assignee_id`, `group_id`, `category_id`, `updated_since`, `q` (title,
  description, root cause, workaround, comments).
- **`POST /problems` body:** `title` (required), `description`, `status` (default
  `NEW`), `priority`, `impact`, `assignee_id`, `group_id`, `category_id`,
  `custom_fields`, through `createProblem`.
- **`PATCH /problems/{id}` body:** `title`, `description`, `priority`, `impact`,
  `assignee_id`, `group_id`, `category_id`, `root_cause`, `workaround`; same
  ordering and partial-failure contract as changes.
- **`POST /problems/{id}/transitions` body:** `{ "to": "<status>" }`. A status that
  needs documentation (e.g. `KNOWN_ERROR` needs a workaround) is refused with `409`
  until it is set via `PATCH`.

Link tickets with `PATCH /tickets/{id}` (`problemId`) and changes with
`PATCH /changes/{id}` (`problem_id`).

### Comments

`GET` returns the thread oldest first, paginated: `id`, `body`, `body_html`,
`internal`, `author`, `created_at` (tickets also `channel`). `POST` takes
`{ "body": "…", "internal": true }`. **`internal` defaults to `true`**, so an
automation has to opt in to writing to a requester. On tickets a public reply
behaves like one typed in the console: it stamps the first response, notifies
watchers and mentions and emails the requester. Change and problem comments send
no mail. Every comment writes an audit row as the token owner.

### Attachments

Files on tickets, changes, problems, assets and licenses live under
`/{entity}/{id}/attachments` (`entity` = `tickets`, `changes`, `problems`, `assets`
or `licenses`; `{id}` is numeric for the first three, a cuid for assets and
licenses). They are the same files the console shows: the ticket's Details tab and
comment thread, and the Attachments card in the rail of a change, problem, asset
or license. The handlers ([`app/api/v1/_attachments.ts`](../app/api/v1/_attachments.ts))
use the console's intake ([`lib/attachment-upload.ts`](../lib/attachment-upload.ts)):
the same storage driver, per-file cap, type allow-list and magic-byte check, and the
console's `deleteAttachment` for removals.

**Who may do what.** Tickets follow the ticket rules: an agent token reads the files
of every ticket and writes (upload, delete) only where its owner may act on the
ticket (assignee, member of the ticket's group, or MANAGER+, as for
`POST /tickets/{id}/comments`, else `403`). A `USER` token sees only its own tickets
(another ticket is a `404`, never a `403`), never sees files on internal notes, may
upload to its own ticket while it is not `CLOSED`/`CANCELLED`, and may delete only
files it uploaded. Changes, problems and assets are agent-only (`403` for a `USER`
token); license files are read by agents and written by **MANAGER+** (the console's
contracts rule). An attachment id that belongs to another record, or that the token
cannot see, is a `404`.

- **`GET /{entity}/{id}/attachments`** (paginated, oldest first): `id`, `filename`
  (the stored, sanitized name), `content_type`, `size` (bytes), `comment_id`
  (tickets: the comment the file belongs to, else `null`), `uploaded_by`
  (`id`, `name`, `email` or `null`), `created_at` and `download_url`. A ticket's list
  includes the files of its comments.
- **`GET /{entity}/{id}/attachments/{attachment_id}`** streams the bytes as stored
  (byte-identical to the upload), with the stored `Content-Type`, `Content-Length`,
  and `Content-Disposition: attachment; filename="…"; filename*=UTF-8''…` (RFC 5987/6266:
  the quoted fallback is printable ASCII only, the exact name is percent-encoded).
  Always a download, never inline, plus `X-Content-Type-Options: nosniff` and a
  sandboxing CSP. The blob is located by its server-generated storage key, so
  nothing in the request can address a path.
- **`POST /{entity}/{id}/attachments`** takes `multipart/form-data` with one part
  `file` and optionally `comment_id` (tickets only: a comment on this ticket; a
  `USER` token only its own public reply; a file on a comment belongs to the
  comment). Responds `201` with the attachment as listed. The form is strict: an
  unknown or repeated part is a `422`. Refusals: `413` larger than `MAX_UPLOAD_MB`
  (Admin Settings, default 15), `415` not multipart or a type / extension / content
  not on the allow-list, `422` no or empty file or an unparsable body, `409` the
  ticket is `CLOSED`/`CANCELLED`, `429` too many uploads (`USER` tokens only,
  `UPLOAD_RATE_LIMIT` per window, shared with the portal; `Retry-After` is set).
  The body is capped while it streams, so an oversized upload is refused without
  being buffered. Next.js passes request bodies through `proxy.ts` only up to
  `PROXY_MAX_BODY_MB` (build time, 32 MB in the published image); a body cut short
  there is reported as `413` when the client declared its `Content-Length`.
- **History import:** a token with the **`import:write` scope (or `admin`) owned by an `ADMIN`** (the
  rule of [History import](#history-import), else `403`) may also send
  `created_at` (ISO with offset, not in the future) and `uploaded_by_id` (an
  existing user, else `422`), and may add files to a closed ticket, e.g. the
  documents of a record from another ITSM tool or the key file of a license.
  - `import_ref` (at most 200 characters, unique across all attachments, e.g.
    `glpi:document:42`) makes re-runs idempotent: when this record already has a
    file with that ref, the upload answers `200` with it and `meta.created: false`,
    stores nothing and writes no audit row. A new ref answers `201` with
    `meta.created: true`. A ref already used on **another** record is a `409`: a
    source file linked to several records needs one ref per record
    (`glpi:document:42:change:129`). Listed files carry `import_ref`.
- **`DELETE /{entity}/{id}/attachments/{attachment_id}`** removes the row and the
  stored blob; responds `{ "data": { "id": "…", "deleted": true } }`.

Each upload writes an audit row (`Attachment`, `CREATE`, "Uploaded … to CHG-0008 via
API" or "Imported …"), each removal one (`DELETE`), as the token owner.

### History import

`POST /import/tickets`, `/import/problems`, `/import/changes` write one record **as
it was in the source system** (e.g. when migrating from GLPI): its final status,
original timestamps, closure details and comment thread. This deliberately
bypasses the lifecycle (no transition map, CAB, SLA clock, mail or automations),
so it needs a token with the **`import:write` scope (or `admin`) whose owner is an `ADMIN`** (else
`403`). The bodies are defined in
[`lib/api-import-input.ts`](../lib/api-import-input.ts) and validated strictly.

- **`import_ref`** (required, ≤ 200 chars, e.g. `glpi:change:129`) identifies the
  source record and is stored as `importRef` (unique). Sending the same ref again
  returns the existing record with `200` and `meta.created: false`; nothing is
  overwritten, so a migration script can be re-run. New records return `201` with
  `meta.created: true`. List endpoints filter by `import_ref`, and every
  serialized ticket, problem and change carries `import_ref`.
- **Required:** `import_ref`, `title`, `status` (any status of the entity, also
  ones the console only reaches through workflows, like `APPROVED`), `created_at`.
- **Timestamps** are ISO with offset. `updated_at` defaults to the latest
  timestamp in the record, including comments. A timestamp before `created_at`
  or an end before its start is a `422`.
- **Changes:** the change fields of `POST /changes` plus `status`, `outcome`,
  `closure_notes`, `cancel_reason`, `created_by_id` (default: the token owner),
  `problem_id`, `actual_start`/`actual_end`. **Problems:** `status`,
  `root_cause`, `workaround`, `resolved_at`. **Tickets:** `type`, `status`,
  `priority`, `impact`, `urgency`, `requester_id` (default: the token owner),
  `assignee_id`, `group_id`, `category_id`, `service_id`, `problem_id`,
  `change_id`, `resolution_code`, `resolution_note`, `first_response_at`,
  `resolved_at`, `closed_at`; imported tickets have `source = API`, no SLA and no
  breach flags.
- **`comments`** (up to 1000): `{ import_ref (optional), body, internal
  (default true), author_id (default: the token owner), created_at }`. The
  comment `import_ref` (≤ 200 chars, e.g. `glpi:followup:812`) is the source id
  of the comment, unique within its record (sending one twice in a body is a
  `422`); the comment endpoints return it as `import_ref`.
- Every referenced id (users incl. comment authors, group, category, service,
  problem, change) is checked first; unknown ids are a `422`, never a `500`.
- One audit row per record (`CREATE`, "Imported from <ref> via API").

Import problems first, then changes and tickets that point at them via
`problem_id` (look ids up with `GET /problems?import_ref=…`). Once imported, a
record is an ordinary one: e.g. a `CLOSED` change is locked like any other —
for the console and the regular API. Only the update mode below rewrites it.

#### Update mode for re-runs

`PUT /import/{tickets|problems|changes}/{import_ref}` brings an imported record
up to the source system's current state, e.g. at cut-over, when a change that
was `DRAFT` at the first import has been closed since and got another comment.
Same token rules (`import:write` scope + `ADMIN` owner) and the same strict body as
the `POST` import; `import_ref` comes from the path (URL-encoded, e.g.
`glpi%3Achange%3A129`) and may be repeated in the body only with the same
value (else `422`). The same checks apply (timeline, unknown ids → `422`).

- **New ref:** the record is created exactly like the `POST` import → `201`,
  `meta.result: "created"`.
- **Existing ref:** the payload is the record's **full current state**. Every
  field the import writes is replaced with the payload's value; an omitted
  optional field falls back to the import default (`risk` `MEDIUM`, `outcome`
  `null`, …), exactly as on a first import. Not touched: the ticket `prefix`
  (the ref stays stable when `type` changes) and `source`; `created_by_id` /
  `requester_id` (they default to the token owner) and `custom_fields` unless
  sent (`{}` clears them); everything outside the import (SLA fields,
  approvals, affected CIs, links, attachments). Lifecycle rules do not apply,
  so a closed or locked record is updated too.
- **Comments are only ever appended**, never edited or removed (comments added
  in Servio after the import stay). A payload comment counts as present when
  the record has a comment with the same `import_ref`, or else — without a
  ref, or with a ref not stored yet (a thread first imported without refs) —
  a ref-less comment with the same `body` and the same `created_at` (to the
  millisecond). Each stored comment matches once, so two identical source
  comments stay two. Sending comment refs makes the dedup robust against
  edited bodies.
- **`created_at`** is part of the source state and replaced when it differs,
  but may not move past the record's earliest comment (`422`).
- **`updated_at`** follows the import rules (the sent value, else the latest
  timestamp in the payload). It is written with any change; on its own it only
  counts as a change when it was sent and differs, so a derived value never
  turns an otherwise identical run into an update.
- **Response:** the record, plus `meta.result` (`created` | `updated` |
  `unchanged`), `meta.changed` (API field names whose value changed, e.g.
  `["status", "outcome", "closure_notes", "actual_end"]`; on `created` every
  field written, defaults included) and `meta.comments_added`. `updated` writes the fields and the
  new comments in one statement and one audit row (`UPDATE`, "Re-imported from
  <ref> via API", meta with `changed` and `commentsAdded`); `unchanged`
  (`200`) writes nothing and no audit row.
- Only records that carry this `importRef` are found: a natively created record
  (no `importRef`) can never be addressed. The `POST` import is unchanged (an
  existing ref is still returned as is).

### Managed configuration records

Catalog items, change templates, contracts and vendors are configuration a
MANAGER maintains in the console, so the endpoints share one shape:

- **Reads** need an agent token; **writes** a token owned by a **MANAGER or ADMIN**
  (else `403`). Bodies are snake_case and strict (unknown keys: `422`).
- `POST /{resource}` creates; `GET` / `PATCH` / `DELETE /{resource}/{id}` read,
  edit and delete. `PATCH` changes only the fields sent (`null` clears a nullable
  one) and answers `meta.changed` with the field names that changed; an unchanged
  body writes nothing and no audit row.
- **Upsert by origin reference**: `import_ref` (optional, unique; same charset as
  the asset reference, no `/`) is the key of the record in an external source.
  `PUT /{resource}/ref/{ref}` creates the record (`201`, the fields a new record
  needs must be present) when the reference is new, otherwise writes only the fields
  sent (`200`); `meta.created` and `meta.changed` say what happened. The ref comes
  from the path (the upsert body has no `import_ref`); `PATCH` with `import_ref`
  adopts an existing record (`null` releases it). `GET /{resource}/ref/{ref}` reads it.
- A unique value already in use (`import_ref`, and the name of vendors and change
  templates) is a `409` with the existing record's `id` in `details`. Unknown ids
  (category, service, group, vendor, owner, asset, approver) are a `422` naming the field.
- Every write leaves an audit row (`… via API` or `… via API (<ref>)`).

#### Catalog items

`GET /catalog-items` (`q` name, `category_id`, `service_id`, `group_id`,
`published=true|false`; ordered like the catalog). Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string, 2–200 | required on create |
| `description`, `short_description`, `icon` | string \| null | `icon` is a lucide icon name |
| `category_id`, `service_id` | string \| null | the service pre-routes and prices the SLA of a request |
| `group_id` | string \| null | team requests are routed to; `null` = the service's team, else the category's, else the triage team |
| `ticket_type` | `REQUEST` \| `INCIDENT` | what a request becomes |
| `title_template` | string \| null | `{{item}}`, `{{requester}}`, `{{<question key>}}`; `null` = "<Item> request" |
| `estimated_days` | integer \| null | |
| `published` | boolean | offered in the portal |
| `order` | integer | position in the catalog; default: the end |
| `requires_approval` | boolean | needs `approver_id` (an active agent) or `approval_stages` (else `422`) |
| `approver_id` | string \| null | single approver |
| `approval_stages` | `[{ approver_id } \| { group_id }]` | ordered stages; a group needs an active agent member. With stages, the stage-1 approver is mirrored into `approver_id` |
| `questions` | array | the request form, replaced as a whole (see below) |

A question is `{ key, label, type, required?, options?, placeholder?, help?,
condition? }`. `key` (letters, digits, `_`, `-`) is unique in the form and names the
answer; `type` is `text`, `textarea`, `select`, `multiselect`, `number`, `date`,
`datetime`, `checkbox`, `urgency`, `asset` or `people`; `select` / `multiselect`
need `options`.

**Conditional questions**: `condition: { field, values }` shows the question — and
only then requires it — when the earlier `select`, `multiselect`, `checkbox` or
`urgency` question `field` is answered with one of `values` (any picked option for
a multiselect; `"true"` / `"false"` for a checkbox; `LOW` / `MEDIUM` / `HIGH` for
urgency). A condition on a question that is itself hidden hides it too. The portal
form, the server-side validation and the portal assistant all honour it, and the
answers to hidden questions are not stored. A condition that does not point at an
earlier choice question, or names an answer it does not offer, is a `422`.

```json
"questions": [
  { "key": "kind", "label": "Hardware or software?", "type": "select", "options": ["Hardware", "Software"], "required": true },
  { "key": "model", "label": "Which model?", "type": "text", "required": true, "condition": { "field": "kind", "values": ["Hardware"] } }
]
```

Deleting an item keeps the requests made from it with their answers.

#### Change templates

`GET /change-templates` (`q` name, `type`, `service_id`, `active=true|false`).
Fields: `name` (3–80, unique), `title` (3–200; both required on create),
`summary`, `active`, `type` (`STANDARD` default \| `NORMAL`), `description`,
`reason`, `implementation_plan`, `rollback_plan`, `risk`, `priority`, `impact`,
`category_id`, `service_id`, `group_id`. A **STANDARD** template is pre-authorized
(changes made from it skip the CAB), so the template that results from a write must
have both plans (else `422` on `implementation_plan` / `rollback_plan`). Deleting a
template keeps the changes made from it.

#### Contracts

`GET /contracts` (`q` name or number, `vendor_id`, `owner_id`, `status`, `type`,
`asset_id` = contracts covering it, `ends_before=YYYY-MM-DD`; ordered by end date).
Fields: `name` (2–200) and `start_date` (YYYY-MM-DD; both required on create),
`number`, `type` (`SUPPORT` default, `MAINTENANCE`, `LEASE`, `SUBSCRIPTION`,
`WARRANTY`, `SERVICE`, `OTHER`), `status` (`ACTIVE` default, `DRAFT`, `EXPIRED`,
`TERMINATED`), `vendor_id`, `owner_id` (receives the renewal reminder), `end_date`,
`cost`, `renewal_notice_days` (default 30), `auto_renew`, `notes`, and `asset_ids` —
the covered assets, replaced as a whole (each link and unlink is audited on the
contract and the asset). The end date may not be before the start date (`422`).
Responses add `vendor`, `owner`, `assets` and `expiry` (`NONE`, `OK`, `EXPIRING`
within the notice period, `EXPIRED`). Deleting a contract keeps its licenses,
without a contract.

### Lookups

`GET /categories` (`id`, `name`, `description`, `icon`, `color`, `parent_id`,
`group_id`, `archived`, `portal_hidden`; archived hidden unless
`include_archived=true`; `GET /categories/{id}` returns one). Categories are one
shared tree for tickets, problems, changes, catalog items, change templates and
articles — there are no separate change categories; a change takes one as
`category_id` on `POST` / `PATCH /changes` and is filtered by it on `GET /changes`. `GET /groups` (`id`,
`name`, `description`, `type`, `email`, `members` with `user_id` and `role`),
`GET /users` (`id`, `name`, `email`, `role`, `active`; `q` matches name or email,
`role`, `active=true|false|all`, paginated).

### Managing categories

`POST /categories` and `PATCH /categories/{id}` need a token whose owner is a
**MANAGER or ADMIN** (else `403`), like the console's category admin. Keys are
snake_case; unknown keys are a `422`.

| Field | Type | Notes |
| --- | --- | --- |
| `name` | string, 2–120 | required on create |
| `description`, `icon` | string \| null | `icon` is a lucide icon name |
| `color` | `#rrggbb` | default `#64748b` |
| `parent_id` | string \| null | `null` = top level; a parent that would put the category under itself is a `422` |
| `group_id` | string \| null | the team that handles it, and the default group of tickets created through the API |
| `portal_hidden` | boolean | staff-only (monitoring, security alerts): the portal does not offer it, and catalog items filed under it are not listed there |
| `archived` | boolean | hidden from pickers and the portal; existing records keep it |

A name already used under the same parent is a `409` with the existing category's
`id` in `details`, so a script can create-or-find its categories. `PATCH` changes
only the fields sent. Both write an audit row.

---

## OpenAPI spec

`GET /api/v1/openapi` serves an OpenAPI 3.1 document
([`app/api/v1/openapi/route.ts`](../app/api/v1/openapi/route.ts)). For the ticket
and asset read paths it is hand-written: minimal `Ticket` and `Asset` schemas. The attachment paths describe their `multipart/form-data`
body and the `Attachment` shape by hand. For the ITSM paths (changes, problems, comments, services,
lookups) the request bodies are generated from the same Zod schemas the handlers
validate with (`z.toJSONSchema`), so they cannot drift; responses are described in
prose. Every operation carries its resource scope in `x-required-scope` and the
scopes that satisfy it as alternative `security` requirements (`bearerAuth:
["tickets:write"]`, `["write"]`, `["admin"]`; OpenAPI 3.1 allows role names for a
non-OAuth scheme). Both come from [`requiredScope`](../lib/api-scopes.ts), the rule
the route test holds every handler to. This page is the authoritative reference.

---

## curl examples

The seed data ([`prisma/seed.ts`](../prisma/seed.ts)) creates a demo token named
**"Demo integration token"** owned by `admin@servio.dev` with scopes `read,write`:

```
servio_demo_pat_0123456789abcdef
```

> Development only. This token exists purely to make the API explorable after
> seeding — never rely on it in production. The Docker entrypoint runs the seed once
> per data volume (`/data/.seeded`, [`docker/entrypoint.sh`](../docker/entrypoint.sh)),
> so a fresh container install also contains this token and its admin owner: revoke
> it under **Settings › API Tokens**.

```bash
BASE=http://localhost:3000/api/v1
TOKEN=servio_demo_pat_0123456789abcdef

# API index (no auth)
curl -s $BASE

# Running version (any token)
curl -s -H "Authorization: Bearer $TOKEN" $BASE/health

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

# Monitoring alert: one open ticket per key (repeat = 200 + internal note)
curl -s -X POST "$BASE/tickets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Disk full on pc-042","description":"95% on /var","external_ref":"zabbix:event:12345","on_duplicate":"comment"}'

# Monitoring recovery: resolve the open ticket for the key
curl -s -X POST "$BASE/tickets/ref/zabbix:event:12345/resolve" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resolution_note":"Recovered: 60% on /var","resolution_code":"FIXED"}'

# Transition a ticket (agent token)
curl -s -X PATCH "$BASE/tickets/1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"IN_PROGRESS"}'

# Search assets
curl -s "$BASE/assets?type=LAPTOP&q=dev" -H "Authorization: Bearer $TOKEN"

# List services and their SLAs
curl -s "$BASE/services" -H "Authorization: Bearer $TOKEN"

# Attach a file to change 8, list the change's files, download one
curl -s -X POST "$BASE/changes/8/attachments" \
  -H "Authorization: Bearer $TOKEN" -F "file=@evidence.pdf"
curl -s "$BASE/changes/8/attachments" -H "Authorization: Bearer $TOKEN"
curl -s -OJ "$BASE/changes/8/attachments/<attachment_id>" -H "Authorization: Bearer $TOKEN"
```

---

## Internal (non-`/api/v1`) endpoints

These routes exist but are **not** part of the public REST API. They are used by the
app UI, authenticate via the **session cookie** (not Bearer tokens), and are not
versioned or guaranteed stable:

| Route | Purpose | File |
| --- | --- | --- |
| `GET /api/search?q=…` | Global spotlight search across tickets, problems, changes, assets, people, services (`AGENT`+; `403` for `USER` sessions) | [`app/api/search/route.ts`](../app/api/search/route.ts) |
| `GET /api/portal/search?q=…` | Portal search for end users: published public articles, published catalog items and the caller's own tickets | [`app/api/portal/search/route.ts`](../app/api/portal/search/route.ts) |
| `GET /api/ai/triage?ticketId=…` | Sable's inline triage suggestion for a ticket (session user, rate-limited by `AI_RATE_LIMIT`). A route handler rather than a Server Action so it does not block the agent's other actions. | [`app/api/ai/triage/route.ts`](../app/api/ai/triage/route.ts) |
| `POST /api/dashboard/widget` | Computes one dashboard widget on demand for the editor's live preview (`AGENT`+) | [`app/api/dashboard/widget/route.ts`](../app/api/dashboard/widget/route.ts) |
| `GET /api/maintenance` | **Public.** Whether maintenance mode is on (`{ "active": false }` otherwise); the maintenance page polls it | [`app/api/maintenance/route.ts`](../app/api/maintenance/route.ts) |
| `GET` / `POST /api/auth/*` | Auth.js handlers (sign-in, callbacks, session) | [`app/api/auth/[...nextauth]/route.ts`](../app/api/auth/[...nextauth]/route.ts) |
| `GET /api/export?type=…` | CSV export. `type=tickets` (AGENT+) exports the ticket list; `type=audit` (ADMIN, honours the viewer's filters) exports the audit log. Returns a `text/csv` download. | [`app/api/export/route.ts`](../app/api/export/route.ts) |
| `POST /api/files/upload` | Attachment upload (session only, never Bearer). `multipart/form-data` with a `file` and at most one target (`ticketId`, `commentId`, `articleId`, `aiProjectId`, `changeId`, `problemId`, `assetId` or `licenseId`); no target stages the file for a later form submit. The per-file cap is `MAX_UPLOAD_MB`. Errors: `401`, `413` (too large), `415` (not multipart, or type / extension / magic bytes not allowed), `422` (no file, empty file, unparsable body, bad target), `429` (`USER`-role accounts only, `UPLOAD_RATE_LIMIT`), plus `400` / `404` / `409` when the target or the store refuses it. | [`app/api/files/upload/route.ts`](../app/api/files/upload/route.ts) |
| `GET /api/files/{id}` | Attachment download | [`app/api/files/[id]/route.ts`](../app/api/files/[id]/route.ts) |
| `GET /api/files/{id}/preview` | Rendered HTML preview of an attachment for the lightbox (files above 25 MB fall back to download) | [`app/api/files/[id]/preview/route.ts`](../app/api/files/[id]/preview/route.ts) |
| `GET /api/files/{id}/pdf` | Office document → PDF preview via Gotenberg (`GOTENBERG_URL`); `204` when the file is not convertible or Gotenberg is not configured or fails | [`app/api/files/[id]/pdf/route.ts`](../app/api/files/[id]/pdf/route.ts) |
| `POST /api/assistant/chat` | Console **Sable** streaming chat turn (`AGENT`+). Consumes the assistant-ui / `useChat` `messages[]` body (plus `conversationId` and optional `context`), rebuilds history server-side from the DB, and streams the reply as an AI SDK UI message stream (`toUIMessageStreamResponse`; the `claude-code` provider is buffered into one uniform stream). `propose_*` tool calls ride back as message metadata for the approve-first cards. | [`app/api/assistant/chat/route.ts`](../app/api/assistant/chat/route.ts) |
| `GET` / `DELETE /api/assistant/chat/{conversationId}/stream` | Console **Sable** running answers (`AGENT`+, own conversations only). `GET` rejoins an answer still streaming (replay so far, then live; `204` when none runs), `DELETE` is the Stop button (`204` stopped, `404` nothing of yours running). The POST run outlives its request; see [ai.md](ai.md#the-streaming-route). | [`app/api/assistant/chat/[id]/stream/route.ts`](../app/api/assistant/chat/[id]/stream/route.ts) |
| `POST /api/portal/assistant` | Portal self-service **Sable** turn (`USER`-scoped, ephemeral — the assistant-ui runtime holds the transcript). Consumes the assistant-ui / `useChat` `messages[]` body and streams the reply as an AI SDK UI message stream (same engine as the console); `propose_*` drafts stream as tool results the portal renders as confirm-to-create ticket/service/comment cards (confirmed via the create endpoint below). | [`app/api/portal/assistant/route.ts`](../app/api/portal/assistant/route.ts) |
| `POST /api/portal/assistant/create` | Confirms and creates the portal assistant's proposed ticket/service/comment. | [`app/api/portal/assistant/create/route.ts`](../app/api/portal/assistant/create/route.ts) |

Do not build integrations against these — use `/api/v1`. While maintenance mode is
active, non-admin sessions get `503` from all of them except `/api/auth/*` and
`/api/maintenance` (see the status codes above).
