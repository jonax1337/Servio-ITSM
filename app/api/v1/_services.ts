import { db } from "@/lib/db";
import { apiError, ok, type ApiPrincipal } from "@/lib/api";
import { hasRole, type Role } from "@/lib/session";
import type { ServicePatch } from "@/lib/api-service-input";
import type { ServiceImpactRow } from "@/lib/service-graph";
import {
  ServiceWriteRefused, SERVICE_ROW_SELECT, resolveServiceWrite, uniqueRefusal, writeService,
  type ServiceRow, type ServiceWriteError,
} from "@/lib/service-records";

/** Shared plumbing of the /services endpoints. */

/** Service management is a MANAGER+ operation, like categories. */
export function managerRefusal(principal: ApiPrincipal) {
  return hasRole(principal.role as Role, "MANAGER")
    ? null
    : apiError(403, "Managing services needs a token owned by a manager or admin.");
}

export const SERVICE_LIST_SELECT = {
  ...SERVICE_ROW_SELECT,
  category: { select: { name: true } },
  sla: { select: { name: true, responseMins: true, resolveMins: true } },
} as const;

type ListRow = ServiceRow & {
  category: { name: string } | null;
  sla: { name: string; responseMins: number; resolveMins: number } | null;
};

/** A service as the list returns it. `category` (name) and `sla` stay for clients of the read-only API. */
export function serializeService(s: ListRow) {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    description: s.description,
    status: s.status,
    criticality: s.criticality,
    icon: s.icon,
    category: s.category?.name ?? null,
    category_id: s.categoryId,
    owner_id: s.ownerId,
    sla_id: s.slaId,
    group_id: s.groupId,
    sla: s.sla ? { name: s.sla.name, response_mins: s.sla.responseMins, resolve_mins: s.sla.resolveMins } : null,
    import_ref: s.importRef,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}

const LINKED_SERVICE = { select: { id: true, code: true, name: true, status: true, criticality: true } } as const;

/** One service with its supporting CIs, what it depends on and what uses it. */
export async function serviceDetail(id: string) {
  const s = await db.service.findUnique({
    where: { id },
    select: {
      ...SERVICE_LIST_SELECT,
      assets: { orderBy: { createdAt: "asc" }, select: { asset: { select: { id: true, name: true, type: true, status: true, importRef: true } } } },
      dependsOn: { orderBy: { createdAt: "asc" }, select: { note: true, toService: LINKED_SERVICE } },
      usedBy: { orderBy: { createdAt: "asc" }, select: { note: true, fromService: LINKED_SERVICE } },
    },
  });
  if (!s) return null;
  const linked = (l: { id: string; code: string | null; name: string; status: string; criticality: string }, note: string | null) => ({
    service_id: l.id, code: l.code, name: l.name, status: l.status, criticality: l.criticality, note,
  });
  return {
    ...serializeService(s),
    assets: s.assets.map(({ asset: a }) => ({ id: a.id, name: a.name, type: a.type, status: a.status, import_ref: a.importRef })),
    depends_on: s.dependsOn.map((d) => linked(d.toService, d.note)),
    used_by: s.usedBy.map((d) => linked(d.fromService, d.note)),
  };
}

/** An entry of an impact list. */
export function serializeImpact(r: ServiceImpactRow) {
  return {
    service_id: r.id,
    code: r.code,
    name: r.name,
    status: r.status,
    criticality: r.criticality,
    depth: r.depth,
    direct: r.direct,
    via: r.via ? { kind: r.via.kind, id: r.via.id, name: r.via.name } : null,
  };
}

export function refusalResponse(e: ServiceWriteError) {
  return apiError(e.status, e.message, e.details);
}

/**
 * Validate and write a service; the shared tail of POST, PATCH and the upsert.
 * Answers with the detail view and `meta.created` / `meta.changed`.
 */
export async function saveService(
  principal: ApiPrincipal,
  body: ServicePatch,
  opts: { id?: string; importRef?: string; via: string },
) {
  const resolved = await resolveServiceWrite(body, opts.id ? { id: opts.id } : undefined);
  if ("error" in resolved) return refusalResponse(resolved.error);
  try {
    const { service, created, changed } = await writeService({
      id: opts.id, body, links: resolved.links, importRef: opts.importRef, userId: principal.userId, via: opts.via,
    });
    return ok(await serviceDetail(service.id), { status: created ? 201 : 200, meta: { created, changed } });
  } catch (err) {
    if (err instanceof ServiceWriteRefused) return refusalResponse(err.refusal);
    const unique = uniqueRefusal(err);
    if (unique) return refusalResponse(unique);
    throw err;
  }
}
