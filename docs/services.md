# Services and the service map

Services are first-class CMDB objects in Servio. A service has a name, an
optional **service number** (`code`, e.g. `S-01`), a status, a criticality, an
owner, a team, an SLA, the **configuration items it runs on** and the **services
it depends on**. From those links Servio works out which services an outage hits,
for a failed service or a failed configuration item.

This page covers the model, the impact rules, the console views and the REST API.
The endpoint reference is in [rest-api.md](./rest-api.md#services); the schema in
[data-model.md](./data-model.md#cmdb--assets).

## Model

| Piece | What it is | Where |
| --- | --- | --- |
| `Service` | The service. `name` and `code` are unique (`code` is optional); `importRef` (unique, optional) is the origin key that `PUT /api/v1/services/ref/{ref}` upserts by. | `prisma/schema.prisma` |
| `ServiceAsset` | "The service runs on this configuration item" (its supporting CIs). | `prisma/schema.prisma` |
| `ServiceDependency` | `fromService` **depends on** `toService`, with an optional `note`. One row per pair. An outage of `toService` affects `fromService` ("`toService` is used by `fromService`"). | `prisma/schema.prisma` |

The service number is free-form within `1-32` characters (letters, digits and
`. _ / -`, starting with a letter or digit). Lists, pickers and the global search
show it in front of the name (`S-01 · Email`, `lib/service-label.ts`), and the
service list and the search also match it.

### Rules for dependencies

- A service cannot depend on itself (`self_dependency`).
- The dependency graph stays acyclic: a write that would close a cycle is refused
  (`dependency_cycle`), and the refusal names the services on the cycle
  (`Mail → Directory → Mail`). The check runs before the write and again inside
  the write transaction, so two concurrent edits cannot build a cycle together.
- Deleting a service removes its own dependencies and CI links. In the console the
  services on the other end get an audit entry; the REST API refuses to delete a
  service anything still points at (see [REST API](#rest-api)).

The rules are pure functions in [`lib/service-graph-rules.ts`](../lib/service-graph-rules.ts)
(`dependencyCycle`, `serviceClosure`, `affectedServices`, `planDependencies`,
`planAssetSet`) and unit-tested in `tests/unit/service-graph-rules.test.ts`.

## Impact

"What goes down if X fails" is answered in three steps
([`lib/service-graph.ts`](../lib/service-graph.ts)):

1. **Configuration items.** From a failed item, the outage travels along the asset
   relations whose meaning implies it (`ASSET_FAILURE_PROPAGATION`,
   `failureClosure` in [`lib/cmdb-graph.ts`](../lib/cmdb-graph.ts)):

   | Relation `source → target` | A failure of … takes down … |
   | --- | --- |
   | `DEPENDS_ON`, `RUNS_ON` | the target → the source |
   | `HOSTS` | the source → the target |
   | `PART_OF` | the source (a part) → the target (the whole) |
   | `CONNECTS_TO`, `BACKS_UP` | nothing propagates |

   The walk stops after 10 hops; every item is visited once.
2. **Services on those items.** Every service that runs on a failed item is hit
   (depth 0). It is **direct** when it runs on the item the question was about,
   indirect when it runs on an item taken down in step 1.
3. **Dependent services.** Everything that depends on a hit service is hit as well,
   transitively; `depth` counts the dependency hops, `via` names the service (or,
   at depth 0, the item) it was reached from.

For a failed **service**, only step 3 applies, starting from that service.

## Console

| Where | What it shows |
| --- | --- |
| Service list (`/services`) | The service number in front of the name; search matches name and number. *Impact analysis* opens the impact page. |
| Service detail (`/services/{id}`) | Supporting CIs (add/remove), **Depends on** (add with an optional note, remove) and **Used by**, and **If this service fails**: the dependants grouped by distance. The edit dialog sets name, service number, icon and description; the sidebar shows the number and the import reference. |
| Impact analysis (`/services/impact`) | Pick a service (`?service=`) or search a configuration item (`?asset=`) and see every affected service, grouped by distance, with what it was reached through. |
| Asset detail (`/assets/{id}`) | Sidebar: the services running on the item and, below, the services also affected when it fails. The *Relationships & impact* tab lists the affected services under the CI blast radius. |
| Ticket, problem and change detail | A read-only **Affected services** card: the services hit through the record's CIs (a ticket's linked assets, a change's affected CIs, a problem's incidents' and changes' CIs). Solid badges run directly on a linked CI; dashed ones are affected indirectly. |

The console actions (`lib/actions/services.ts`) are open to agents, like the rest
of the service page: `createService` / `updateService` (with `code`),
`addServiceDependency` (re-adding updates the note), `removeServiceDependency`,
`linkServiceAsset` / `unlinkServiceAsset`, `deleteService`. Each writes an audit
row on both ends of a link.

## REST API

All endpoints need an agent token; writes need a token owned by a **MANAGER or
ADMIN** (like categories) and the `write` scope. Bodies are snake_case and strict
(an unknown field is a `422`), validated by
[`lib/api-service-input.ts`](../lib/api-service-input.ts); the write path is shared
with the upsert in [`lib/service-records.ts`](../lib/service-records.ts).

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/services` | The portfolio (not paginated). Filters `status`, `criticality`, `code`, `import_ref`, `q` (name or code). |
| `POST` | `/services` | Create, with `asset_ids` and `depends_on`; optional `import_ref`. |
| `GET` | `/services/{id}` | One service with `assets`, `depends_on` and `used_by`. |
| `PATCH` | `/services/{id}` | Change the fields sent; `asset_ids` / `depends_on` replace their whole set. |
| `DELETE` | `/services/{id}` | Delete, or `409` while referenced (suggests `status: RETIRED`). |
| `GET` | `/services/{id}/impact` | The services that go down with it. |
| `GET` / `PUT` | `/services/ref/{ref}` | Read / upsert by origin reference (idempotent). |
| `GET` | `/assets/{id}/services` | The services an outage of the asset hits. |

Writable fields: `name`, `code`, `description`, `status`, `criticality`, `icon`,
`category_id`, `owner_id`, `sla_id`, `group_id`, `asset_ids` and `depends_on`
(each entry `{ "service_id": "…" }` or `{ "service_ref": "…" }`, plus an optional
`note`). `meta.changed` lists the fields a write changed; an upsert that sends the
same facts again changes nothing and writes no audit row.

```bash
# Push a small service map in dependency order: the directory first, then mail on top of it.
curl -s -X PUT "$BASE/services/ref/catalog:directory" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Directory","code":"S-02","criticality":"CRITICAL","asset_ids":["<dc asset id>"]}'
curl -s -X PUT "$BASE/services/ref/catalog:mail" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Email","code":"S-01","depends_on":[{"service_ref":"catalog:directory","note":"sign-in"}]}'
```

Refusals carry a machine-readable `details.code`:

| Status | `details.code` | When |
| --- | --- | --- |
| `422` | `self_dependency` | `depends_on` names the service itself |
| `422` | `dependency_cycle` | the set would close a cycle; `details.cycle` lists `{ id, name }` along it |
| `422` | `unknown_reference` | an unknown category, owner, SLA, group, asset, `service_id` or `service_ref` |
| `422` | `duplicate_entry` | the same asset or service listed twice |
| `409` | `name_taken` / `code_taken` / `import_ref_taken` | a unique value is used by another service (its `id` in `details`) |
| `409` | `service_in_use` | `DELETE` while tickets, catalog items, dependent services, status incidents, change templates, recurring tickets or freeze windows point at it; `details.references` counts them |

Tickets reference a service through `service_id` on `POST /tickets` and
`PATCH /tickets/{id}` (camelCase `serviceId` is accepted too); a new service
re-prices the SLA deadlines of an open ticket, as in the console.
