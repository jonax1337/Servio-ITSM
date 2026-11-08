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

Each protected handler calls `guard(req, "read" | "write")`, which first applies the
rate limit (`429`), then returns `401` if the token is invalid and `403` if it lacks
the required scope. No handler checks `admin` on its own; it only widens `read`/`write`.

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
| CORS | Default **closed**: no `Access-Control-*` headers are emitted unless `API_CORS_ORIGIN` is set to an explicit origin (never `*`); when set, methods `GET, POST, PATCH, OPTIONS`, allowed headers `Authorization, Content-Type`. Every route except `/openapi` implements `OPTIONS` (preflight → `204`). `GET /openapi` is the exception: it always sends `Access-Control-Allow-Origin: *`. |
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
| `403` | Token lacks the required scope, or is a non-agent hitting an agent-only resource (`/assets`, `/services`) |
| `404` | Resource not found (or hidden from a non-agent); a non-numeric ticket id is also `404` |
| `409` | Illegal ticket status transition, a merged ticket (only `CANCELLED` is allowed), or a request awaiting approval (only cancelling is allowed) |
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

Pagination applies to every list endpoint except `GET /services`, `/categories`, `/groups` and `/assets/{id}/relations` (those return everything) via
[`paginate`](../lib/api.ts):

| Param | Default | Bounds |
| --- | --- | --- |
| `page` | `1` | `>= 1` |
| `per_page` | `25` | `1`–`100` (clamped) |

**Filtering** is per-endpoint (only the params below exist — anything else is ignored):

| Endpoint | Filters |
| --- | --- |
| `GET /tickets` | `status` (exact, or the special value `open` → any open status), `priority`, `type`, `q` (substring match on `title`) |
| `GET /assets` | `type`, `status`, `q` (substring match across `name`, `assetTag`, `serial`); exact: `serial`, `asset_tag`, `ip_address`, `mac_address`, `import_ref`, `owner_id`, `group_id`, `updated_since` |

**Sorting is fixed** (not client-configurable): tickets by `updatedAt` descending,
assets by `name` ascending, services by `name` ascending.

---

## Endpoint reference

Paths are relative to `/api/v1`. "Scope" is the scope required by the handler; the
`admin` scope satisfies all of them.

| Method | Path | Description | Scope |
| --- | --- | --- | --- |
| `GET` | `/` | API index: name, version, and resource links. **No auth.** | — |
| `GET` | `/openapi` | OpenAPI 3.1 spec (JSON) — see [OpenAPI spec](#openapi-spec). **No auth.** | — |
| `GET` | `/tickets` | List tickets (paginated, filterable). Non-agents see only their own. | `read` |
| `POST` | `/tickets` | Create a ticket (`source = API`). | `write` |
| `GET` | `/tickets/{id}` | Get one ticket by numeric id. | `read` |
| `PATCH` | `/tickets/{id}` | Update a ticket (agents only). Enforces status-transition rules + SLA clock. | `write` |
| `GET` | `/assets` | List assets (paginated, filterable). Agent tokens only. | `read` |
| `POST` | `/assets` | Create an asset. Agent tokens only. | `write` |
| `GET` | `/assets/{id}` | Get one asset by id (cuid string). Agent tokens only. | `read` |
| `PATCH` | `/assets/{id}` | Update any asset field. Agent tokens only. | `write` |
| `GET` / `PUT` | `/assets/ref/{ref}` | Read / upsert an asset by its origin reference (for syncs). | `read` / `write` |
| `GET` / `POST` | `/assets/{id}/relations` | List / add dependency edges. | `read` / `write` |
| `DELETE` | `/assets/{id}/relations/{relation_id}` | Remove an edge. | `write` |
| `GET` / `POST` | `/vendors` | List / create vendors (writes: MANAGER+). | `read` / `write` |
| `GET` / `PATCH` | `/vendors/{id}` | Get / edit a vendor. | `read` / `write` |
| `GET` / `POST` | `/licenses` | List / create software licenses (writes: MANAGER+). | `read` / `write` |
| `GET` / `PATCH` | `/licenses/{id}` | Get / edit a license. | `read` / `write` |
| `POST` | `/licenses/{id}/assignments` | Assign a seat to an asset and/or user. | `write` |
| `DELETE` | `/licenses/{id}/assignments/{assignment_id}` | Release a seat. | `write` |
| `GET` / `POST` | `/recurring-tickets` | List / create recurring ticket schedules (writes: MANAGER+). | `read` / `write` |
| `GET` / `PATCH` / `DELETE` | `/recurring-tickets/{id}` | Get / edit, pause or resume / delete a schedule. | `read` / `write` |
| `GET` | `/services` | List services with status, criticality, category, and SLA (not paginated). Agent tokens only. | `read` |
| `GET` | `/tickets/{id}/comments` | A ticket's thread (oldest first, paginated). Users: public replies of their own tickets. | `read` |
| `POST` | `/tickets/{id}/comments` | Add a reply or internal note (agents who may act on the ticket). | `write` |
| `GET` | `/changes` | List changes (paginated, filterable, full-text `q`). Agent tokens only. | `read` |
| `POST` | `/changes` | Create a change (always `DRAFT`). Agent tokens only. | `write` |
| `GET` | `/changes/{id}` | Get one change with approvals and affected CIs. | `read` |
| `PATCH` | `/changes/{id}` | Edit fields, plans, window, problem link (not the status). | `write` |
| `POST` | `/changes/{id}/transitions` | Move along the lifecycle, incl. submit for approval. | `write` |
| `POST` | `/changes/{id}/approvals/{approval_id}` | Record a CAB decision. | `write` |
| `GET`/`POST` | `/changes/{id}/comments` | List / add comments. | `read` / `write` |
| `GET` | `/problems` | List problems (paginated, filterable, full-text `q`). Agent tokens only. | `read` |
| `POST` | `/problems` | Create a problem. Agent tokens only. | `write` |
| `GET` | `/problems/{id}` | Get one problem with linked tickets and changes. | `read` |
| `PATCH` | `/problems/{id}` | Edit fields, root cause, workaround (not the status). | `write` |
| `POST` | `/problems/{id}/transitions` | Move along the lifecycle. | `write` |
| `GET`/`POST` | `/problems/{id}/comments` | List / add comments. | `read` / `write` |
| `GET` | `/categories` | Categories, to resolve a `category_id`. Agent tokens only. | `read` |
| `GET` | `/groups` | Groups with member ids. Agent tokens only. | `read` |
| `GET` | `/users` | User lookup, minimal fields (`q`, `role`, `active`). Agent tokens only. | `read` |
| `POST` | `/import/tickets` | Import a historical ticket with its thread (see [History import](#history-import)). | `admin` + ADMIN owner |
| `POST` | `/import/problems` | Import a historical problem with its thread. | `admin` + ADMIN owner |
| `POST` | `/import/changes` | Import a historical change with its thread. | `admin` + ADMIN owner |

The only `DELETE` endpoints are asset relations, license seats and recurring
ticket schedules; there are no endpoints for knowledge or releases yet.

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
`urgency` are honored; all other fields fall back to defaults (an unknown
`requesterId`/`categoryId`/`serviceId` is still rejected with `422` before that
filtering). SLA response/resolve
deadlines are resolved from the service + priority at creation time. Agents may
pick a starting status, but only an **open** one (`NEW`, `OPEN`, `IN_PROGRESS`,
`PENDING`, `ON_HOLD`) — a ticket can't be born `RESOLVED`/`CLOSED`/`CANCELLED`,
which would skip breach stamping, automations and the survey pipeline (else `422`).

**`PATCH /tickets/{id}` body** (agents only): `title` (min 3), `description`, `status`,
`priority`, `assigneeId` (nullable), `problemId` / `changeId` (integer, `null`
unlinks; applied through the console's `setTicketProblem` / `setTicketChange`, so
only someone who may act on the ticket can link it, else `403`). The serialized
ticket carries `problem_id` and `change_id`. Changing `status`:

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
  "id": "clx…", "asset_tag": "LT-0007", "name": "Dev Laptop 07", "type": "LAPTOP", "status": "IN_USE",
  "serial": "SN123", "model": "…", "manufacturer": "…",
  "location": "HQ", "location_ref": { "id": "…", "name": "Berlin HQ" },
  "ip_address": "10.0.0.7", "mac_address": "aa:bb:cc:dd:ee:01", "os": "Ubuntu 24.04",
  "cpu": "i5-12400T", "ram_gb": 16, "storage_gb": 512, "cost": 899, "purchase_date": "2024-05-01", "warranty_end": "2027-05-01",
  "notes": "…", "owner": { "id": "…", "name": "…", "email": "…" }, "group": { "id": "…", "name": "IT" },
  "external_id": null, "import_ref": "opsi:host:ws01", "last_seen_at": "…",
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
asset's origin key, chosen by the caller, e.g. `opsi:host:ws01.intern` or
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
console's rule for vendors, contracts and licenses; else `403`). Writes go through
the console's actions in `lib/actions/contracts.ts`. Bodies are snake_case and strict.

- `GET /vendors` (`name` exact, `q`, `active`), `POST /vendors` `{ name, website?,
  email?, phone?, notes? }` (names are unique: duplicate `409`), `GET` / `PATCH
  /vendors/{id}` (`active` to deactivate; fields left out keep their value).
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
  - `create_before_days` must be shorter than the shortest step (1 / 7 / 28 / 365
    days × `interval`; so `0` for every day, at most `27` for every month); else
    `422` on `create_before_days`.
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
  never on a change they requested or own (`409`).
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

### History import

`POST /import/tickets`, `/import/problems`, `/import/changes` write one record **as
it was in the source system** (e.g. when migrating from GLPI): its final status,
original timestamps, closure details and comment thread. This deliberately
bypasses the lifecycle (no transition map, CAB, SLA clock, mail or automations),
so it needs a token with the **`admin` scope whose owner is an `ADMIN`** (else
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
- **`comments`** (up to 1000): `{ body, internal (default true), author_id
  (default: the token owner), created_at }`.
- Every referenced id (users incl. comment authors, group, category, service,
  problem, change) is checked first; unknown ids are a `422`, never a `500`.
- One audit row per record (`CREATE`, "Imported from <ref> via API").

Import problems first, then changes and tickets that point at them via
`problem_id` (look ids up with `GET /problems?import_ref=…`). Once imported, a
record is an ordinary one: e.g. a `CLOSED` change is locked like any other.

### Lookups

`GET /categories` (`id`, `name`, `description`, `parent_id`, `group_id`,
`archived`; archived hidden unless `include_archived=true`), `GET /groups` (`id`,
`name`, `description`, `type`, `email`, `members` with `user_id` and `role`),
`GET /users` (`id`, `name`, `email`, `role`, `active`; `q` matches name or email,
`role`, `active=true|false|all`, paginated).

---

## OpenAPI spec

`GET /api/v1/openapi` serves an OpenAPI 3.1 document
([`app/api/v1/openapi/route.ts`](../app/api/v1/openapi/route.ts)). For the ticket,
asset and service paths it is hand-written: minimal `Ticket` and `Asset` schemas
and no write-body detail. For the ITSM paths (changes, problems, comments,
lookups) the request bodies are generated from the same Zod schemas the handlers
validate with (`z.toJSONSchema`), so they cannot drift; responses are described in
prose. This page is the authoritative reference.

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
| `GET /api/search?q=…` | Global spotlight search across tickets, problems, changes, assets, people, services (`AGENT`+; `403` for `USER` sessions) | [`app/api/search/route.ts`](../app/api/search/route.ts) |
| `GET /api/portal/search?q=…` | Portal search for end users: published public articles, published catalog items and the caller's own tickets | [`app/api/portal/search/route.ts`](../app/api/portal/search/route.ts) |
| `GET /api/ai/triage?ticketId=…` | Sable's inline triage suggestion for a ticket (session user, rate-limited by `AI_RATE_LIMIT`). A route handler rather than a Server Action so it does not block the agent's other actions. | [`app/api/ai/triage/route.ts`](../app/api/ai/triage/route.ts) |
| `POST /api/dashboard/widget` | Computes one dashboard widget on demand for the editor's live preview (`AGENT`+) | [`app/api/dashboard/widget/route.ts`](../app/api/dashboard/widget/route.ts) |
| `GET /api/maintenance` | **Public.** Whether maintenance mode is on (`{ "active": false }` otherwise); the maintenance page polls it | [`app/api/maintenance/route.ts`](../app/api/maintenance/route.ts) |
| `GET` / `POST /api/auth/*` | Auth.js handlers (sign-in, callbacks, session) | [`app/api/auth/[...nextauth]/route.ts`](../app/api/auth/[...nextauth]/route.ts) |
| `GET /api/export?type=…` | CSV export. `type=tickets` (AGENT+) exports the ticket list; `type=audit` (ADMIN, honours the viewer's filters) exports the audit log. Returns a `text/csv` download. | [`app/api/export/route.ts`](../app/api/export/route.ts) |
| `POST /api/files/upload` | Attachment upload (session only, never Bearer). `multipart/form-data` with a `file` and at most one target (`ticketId`, `commentId`, `articleId` or `aiProjectId`); no target stages the file for a later form submit. The per-file cap is `MAX_UPLOAD_MB`. Errors: `401`, `413` (too large), `415` (not multipart, or type / extension / magic bytes not allowed), `422` (no file, empty file, unparsable body, bad target), `429` (`USER`-role accounts only, `UPLOAD_RATE_LIMIT`), plus `400` / `404` / `409` when the target or the store refuses it. | [`app/api/files/upload/route.ts`](../app/api/files/upload/route.ts) |
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
