import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { changedServiceColumns, duplicates, serviceData, type DependencyEntry, type ServicePatch } from "@/lib/api-service-input";
import { dependencyCycle, planAssetSet, planDependencies, type DependencyWant } from "@/lib/service-graph-rules";

/**
 * Write side of services as CMDB objects, shared by the REST API
 * (app/api/v1/services/*) and the console actions (lib/actions/services.ts):
 * reference checks, the dependency cycle guard, the replace-the-set semantics
 * of `asset_ids` / `depends_on`, and the audit trail. Callers authorize first.
 */

/** A refused write: the HTTP status the API answers with, the message and machine-readable details. */
export type ServiceWriteError = { status: 404 | 409 | 422; message: string; details?: Record<string, unknown> };

/** Codes in `details.code`, so a client can tell the refusals apart without parsing the message. */
export const SERVICE_ERROR_CODES = {
  selfDependency: "self_dependency",
  cycle: "dependency_cycle",
  unknownReference: "unknown_reference",
  duplicateEntry: "duplicate_entry",
  nameTaken: "name_taken",
  codeTaken: "code_taken",
  importRefTaken: "import_ref_taken",
  inUse: "service_in_use",
} as const;

export class ServiceWriteRefused extends Error {
  constructor(readonly refusal: ServiceWriteError) {
    super(refusal.message);
  }
}

const invalid = (field: string, message: string, code: string = SERVICE_ERROR_CODES.unknownReference, extra?: Record<string, unknown>): ServiceWriteError => ({
  status: 422,
  message: "Validation failed",
  details: { [field]: [message], code, ...extra },
});

/** The validated links of a write, resolved to ids (undefined = leave that set alone). */
export type ResolvedLinks = { assetIds?: string[]; dependsOn?: DependencyWant[] };

/**
 * Check every id and ref a body names and resolve `depends_on` refs to ids.
 * `current` is the service being edited (absent on create). The cycle check
 * runs again inside the write transaction, so a concurrent edit cannot slip a
 * cycle past it.
 */
export async function resolveServiceWrite(
  b: ServicePatch,
  current?: { id: string },
): Promise<{ error: ServiceWriteError } | { links: ResolvedLinks }> {
  const exists = {
    category_id: (id: string) => db.category.findUnique({ where: { id }, select: { id: true } }),
    owner_id: (id: string) => db.user.findUnique({ where: { id }, select: { id: true } }),
    sla_id: (id: string) => db.sLA.findUnique({ where: { id }, select: { id: true } }),
    group_id: (id: string) => db.group.findUnique({ where: { id }, select: { id: true } }),
  } as const;
  for (const field of Object.keys(exists) as (keyof typeof exists)[]) {
    const id = b[field];
    if (id && !(await exists[field](id))) return { error: invalid(field, `Unknown ${field.replace("_id", "")}: ${id}`) };
  }

  const notSelf = current ? { id: { not: current.id } } : {};
  if (b.name) {
    const clash = await db.service.findFirst({ where: { name: b.name, ...notSelf }, select: { id: true } });
    if (clash) return { error: { status: 409, message: "A service with this name already exists.", details: { id: clash.id, code: SERVICE_ERROR_CODES.nameTaken } } };
  }
  if (b.code) {
    const clash = await db.service.findFirst({ where: { code: b.code, ...notSelf }, select: { id: true } });
    if (clash) return { error: { status: 409, message: "A service with this code already exists.", details: { id: clash.id, code: SERVICE_ERROR_CODES.codeTaken } } };
  }

  const links: ResolvedLinks = {};
  if (b.asset_ids) {
    const dup = duplicates(b.asset_ids);
    if (dup.length) return { error: invalid("asset_ids", `Listed more than once: ${dup.join(", ")}`, SERVICE_ERROR_CODES.duplicateEntry) };
    const found = await db.asset.findMany({ where: { id: { in: b.asset_ids } }, select: { id: true } });
    const missing = b.asset_ids.filter((id) => !found.some((a) => a.id === id));
    if (missing.length) return { error: invalid("asset_ids", `Unknown asset: ${missing.join(", ")}`) };
    links.assetIds = b.asset_ids;
  }
  if (b.depends_on) {
    const resolved = await resolveDependencies(b.depends_on);
    if ("error" in resolved) return resolved;
    const dup = duplicates(resolved.deps.map((d) => d.toServiceId));
    if (dup.length) return { error: invalid("depends_on", `Listed more than once: ${dup.join(", ")}`, SERVICE_ERROR_CODES.duplicateEntry) };
    if (current) {
      const cycle = await cycleError(current.id, resolved.deps.map((d) => d.toServiceId));
      if (cycle) return { error: cycle };
    }
    links.dependsOn = resolved.deps;
  }
  return { links };
}

async function resolveDependencies(entries: DependencyEntry[]): Promise<{ deps: DependencyWant[] } | { error: ServiceWriteError }> {
  const ids = entries.flatMap((e) => (e.service_id ? [e.service_id] : []));
  const refs = entries.flatMap((e) => (e.service_ref ? [e.service_ref] : []));
  const [byId, byRef] = await Promise.all([
    ids.length ? db.service.findMany({ where: { id: { in: ids } }, select: { id: true } }) : [],
    refs.length ? db.service.findMany({ where: { importRef: { in: refs } }, select: { id: true, importRef: true } }) : [],
  ]);
  const refToId = new Map(byRef.map((s) => [s.importRef!, s.id]));
  const knownIds = new Set(byId.map((s) => s.id));
  const missing = [
    ...ids.filter((id) => !knownIds.has(id)).map((id) => `service_id ${id}`),
    ...refs.filter((r) => !refToId.has(r)).map((r) => `service_ref ${r}`),
  ];
  if (missing.length) return { error: invalid("depends_on", `Unknown service: ${missing.join(", ")}`) };
  return {
    deps: entries.map((e) => ({ toServiceId: e.service_id ?? refToId.get(e.service_ref!)!, note: e.note || null })),
  };
}

/** The 422 for a dependency set that would depend on itself or close a cycle, naming the services on the cycle. */
export async function cycleError(serviceId: string, targetIds: string[], client: Prisma.TransactionClient | typeof db = db): Promise<ServiceWriteError | null> {
  const edges = (await client.serviceDependency.findMany({ select: { fromServiceId: true, toServiceId: true } })).map((r) => ({
    from: r.fromServiceId,
    to: r.toServiceId,
  }));
  const cycle = dependencyCycle(edges, serviceId, targetIds);
  if (!cycle) return null;
  if (cycle.length === 2) return invalid("depends_on", "A service cannot depend on itself.", SERVICE_ERROR_CODES.selfDependency);
  const names = await client.service.findMany({ where: { id: { in: cycle } }, select: { id: true, name: true } });
  const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? id;
  return invalid("depends_on", `This would close a dependency cycle: ${cycle.map(nameOf).join(" → ")}`, SERVICE_ERROR_CODES.cycle, {
    cycle: cycle.map((id) => ({ id, name: nameOf(id) })),
  });
}

export const SERVICE_ROW_SELECT = {
  id: true, name: true, code: true, importRef: true, description: true, status: true, criticality: true, icon: true,
  categoryId: true, ownerId: true, slaId: true, groupId: true, createdAt: true, updatedAt: true,
} as const;
export type ServiceRow = Prisma.ServiceGetPayload<{ select: typeof SERVICE_ROW_SELECT }>;

/**
 * Create (`id` absent) or update a service with its links, in one transaction,
 * and write the audit rows. Returns the API field names that changed; an update
 * that changes nothing writes nothing (that is what makes the upsert by
 * `import_ref` idempotent). Throws ServiceWriteRefused when the dependency set
 * would close a cycle at write time.
 */
export async function writeService(input: {
  id?: string;
  body: ServicePatch;
  links: ResolvedLinks;
  importRef?: string;
  userId: string;
  /** Appended to the audit summary, e.g. "via API (catalog:mail)". */
  via: string;
}): Promise<{ service: ServiceRow; created: boolean; changed: string[] }> {
  const data = serviceData(input.body);
  const result = await db.$transaction(async (tx) => {
    const before = input.id ? await tx.service.findUnique({ where: { id: input.id }, select: SERVICE_ROW_SELECT }) : null;
    if (input.id && !before) throw new ServiceWriteRefused({ status: 404, message: "Service not found" });
    const changedCols = before ? changedServiceColumns(before, data) : Object.keys(data);
    const service = before
      ? changedCols.length
        ? await tx.service.update({ where: { id: before.id }, data: pick(data, changedCols), select: SERVICE_ROW_SELECT })
        : before
      : await tx.service.create({
          data: { ...(data as Prisma.ServiceUncheckedCreateInput), ...(input.importRef && { importRef: input.importRef }) },
          select: SERVICE_ROW_SELECT,
        });
    const changed = changedCols.map(apiName);

    const assetChanges = { add: [] as string[], remove: [] as string[] };
    const dependencyChanges = { add: [] as string[], remove: [] as string[] };
    if (input.links.assetIds) {
      const current = await tx.serviceAsset.findMany({ where: { serviceId: service.id }, select: { assetId: true } });
      const plan = planAssetSet(current.map((c) => c.assetId), input.links.assetIds);
      if (plan.remove.length) await tx.serviceAsset.deleteMany({ where: { serviceId: service.id, assetId: { in: plan.remove } } });
      for (const assetId of plan.add) await tx.serviceAsset.create({ data: { serviceId: service.id, assetId } });
      if (plan.changed) changed.push("asset_ids");
      Object.assign(assetChanges, plan);
    }
    if (input.links.dependsOn) {
      if (before) {
        const cycle = await cycleError(service.id, input.links.dependsOn.map((d) => d.toServiceId), tx);
        if (cycle) throw new ServiceWriteRefused(cycle);
      }
      const current = await tx.serviceDependency.findMany({ where: { fromServiceId: service.id }, select: { toServiceId: true, note: true } });
      const plan = planDependencies(current, input.links.dependsOn);
      if (plan.remove.length) await tx.serviceDependency.deleteMany({ where: { fromServiceId: service.id, toServiceId: { in: plan.remove } } });
      for (const d of plan.add) await tx.serviceDependency.create({ data: { fromServiceId: service.id, toServiceId: d.toServiceId, note: d.note } });
      for (const d of plan.renote) {
        await tx.serviceDependency.update({ where: { fromServiceId_toServiceId: { fromServiceId: service.id, toServiceId: d.toServiceId } }, data: { note: d.note } });
      }
      if (plan.changed) changed.push("depends_on");
      dependencyChanges.add = plan.add.map((d) => d.toServiceId);
      dependencyChanges.remove = plan.remove;
    }
    return { service, created: !before, changed, assetChanges, dependencyChanges };
  });

  const { service, created, changed, assetChanges, dependencyChanges } = result;
  if (created || changed.length) {
    await writeAudit({
      userId: input.userId,
      action: created ? "CREATE" : "UPDATE",
      entity: "Service",
      entityId: service.id,
      summary: created ? `Created service "${service.name}" ${input.via}` : `Updated service "${service.name}" ${input.via} (${changed.join(", ")})`,
    });
  }
  for (const assetId of assetChanges.add) {
    await writeAudit({ userId: input.userId, action: "UPDATE", entity: "Asset", entityId: assetId, summary: `Added to service "${service.name}" ${input.via}` });
  }
  for (const assetId of assetChanges.remove) {
    await writeAudit({ userId: input.userId, action: "UPDATE", entity: "Asset", entityId: assetId, summary: `Removed from service "${service.name}" ${input.via}` });
  }
  // The other end of a dependency keeps a trace as well (the console does the same).
  for (const toId of dependencyChanges.add) {
    await writeAudit({ userId: input.userId, action: "UPDATE", entity: "Service", entityId: toId, summary: `Used by "${service.name}" ${input.via}` });
  }
  for (const toId of dependencyChanges.remove) {
    await writeAudit({ userId: input.userId, action: "UPDATE", entity: "Service", entityId: toId, summary: `No longer used by "${service.name}" ${input.via}` });
  }
  return { service, created, changed };
}

/**
 * Record (or re-note) one dependency edge for the console: the cycle check and
 * the upsert run in one transaction, so a concurrent edit cannot slip a cycle
 * past the check. Throws ServiceWriteRefused when it would close a cycle.
 */
export async function saveDependency(fromServiceId: string, toServiceId: string, note: string | null) {
  await db.$transaction(async (tx) => {
    const cycle = await cycleError(fromServiceId, [toServiceId], tx);
    if (cycle) throw new ServiceWriteRefused(cycle);
    await tx.serviceDependency.upsert({
      where: { fromServiceId_toServiceId: { fromServiceId, toServiceId } },
      create: { fromServiceId, toServiceId, note },
      update: { note },
    });
  });
}

const API_NAMES: Record<string, string> = { categoryId: "category_id", ownerId: "owner_id", slaId: "sla_id", groupId: "group_id" };
const apiName = (column: string) => API_NAMES[column] ?? column;

function pick(data: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, data[k]]));
}

/** A unique index lost to a concurrent writer, as the refusal the pre-check would have given. */
export function uniqueRefusal(err: unknown): ServiceWriteError | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return null;
  const target = String(err.meta?.target ?? "");
  if (target.includes("importRef")) return { status: 409, message: "A service with this import_ref already exists.", details: { code: SERVICE_ERROR_CODES.importRefTaken } };
  if (target.includes("code")) return { status: 409, message: "A service with this code already exists.", details: { code: SERVICE_ERROR_CODES.codeTaken } };
  if (target.includes("name")) return { status: 409, message: "A service with this name already exists.", details: { code: SERVICE_ERROR_CODES.nameTaken } };
  return { status: 409, message: "A unique value is already taken.", details: {} };
}

/**
 * What still points at a service, i.e. what a delete would unlink or destroy.
 * Its own supporting CIs and its own dependencies are part of the service and
 * do not count. Empty = safe to delete.
 */
export async function serviceReferences(id: string) {
  const [tickets, catalogItems, usedBy, statusIncidents, changeTemplates, recurringTickets, freezeWindows] = await Promise.all([
    db.ticket.count({ where: { serviceId: id } }),
    db.catalogItem.count({ where: { serviceId: id } }),
    db.serviceDependency.count({ where: { toServiceId: id } }),
    db.statusIncidentService.count({ where: { serviceId: id } }),
    db.changeTemplate.count({ where: { serviceId: id } }),
    db.recurringTicket.count({ where: { serviceId: id } }),
    db.changeFreezeWindow.count({ where: { serviceId: id } }),
  ]);
  const all = {
    tickets, catalog_items: catalogItems, used_by: usedBy, status_incidents: statusIncidents,
    change_templates: changeTemplates, recurring_tickets: recurringTickets, freeze_windows: freezeWindows,
  };
  return Object.fromEntries(Object.entries(all).filter(([, n]) => n > 0)) as Partial<typeof all>;
}
