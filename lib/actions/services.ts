"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAgentUser, requireManagerUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { SERVICE_STATUSES, CRITICALITIES } from "@/lib/constants";
import type { ActionResult } from "@/lib/action-result";
import { SERVICE_CODE_HINT, SERVICE_CODE_RE } from "@/lib/api-service-input";
import { ServiceWriteRefused, saveDependency, serviceReferences } from "@/lib/service-records";
import { agentMayUpdateField, inUseRefusal } from "@/lib/service-access";

/** Managing services is MANAGER+ (like the API and categories); DB-truth, see requireManagerUser. */
async function requireManager() {
  return requireManagerUser();
}

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" && v !== "" ? v : null));

const optionalIcon = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null));

/** The short service number ("S-01"); empty = none. Same format as the API's `code`. */
const optionalCode = z
  .string()
  .optional()
  .transform((v) => v?.trim() ?? "")
  .refine((v) => v === "" || SERVICE_CODE_RE.test(v), SERVICE_CODE_HINT)
  .transform((v) => (v === "" ? null : v));

const createSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  code: optionalCode,
  description: z.string().default(""),
  icon: optionalIcon,
  status: z.enum(SERVICE_STATUSES).default("OPERATIONAL"),
  criticality: z.enum(CRITICALITIES).default("MEDIUM"),
  categoryId: optionalId,
  ownerId: optionalId,
  slaId: optionalId,
  groupId: optionalId,
});

export type ActionState =
  | { error?: string; fieldErrors?: Record<string, string[]> }
  | undefined;

/** A lost unique index as the form's field error (name and code are both unique). */
function uniqueFieldError(e: unknown): ActionState | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return null;
  return String(e.meta?.target ?? "").includes("code")
    ? { error: "A service with that code already exists.", fieldErrors: { code: ["Code must be unique"] } }
    : { error: "A service with that name already exists.", fieldErrors: { name: ["Name must be unique"] } };
}

export async function createService(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const me = await requireManager();
  if (!me) return { error: "Not authorised" };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  let service;
  try {
    service = await db.service.create({ data });
  } catch (e) {
    const fieldError = uniqueFieldError(e);
    if (fieldError) return fieldError;
    throw e;
  }

  await writeAudit({
    userId: me.id,
    action: "CREATE",
    entity: "Service",
    entityId: service.id,
    summary: `Created service "${service.name}"`,
  });

  revalidatePath("/services");
  redirect(`/services/${service.id}`);
}

const updateSchema = z.object({
  id: z.string().min(1),
  field: z.enum(["status", "criticality", "categoryId", "ownerId", "slaId", "groupId"]),
  value: z.string(),
});

export async function updateServiceField(formData: FormData) {
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { id, field, value } = parsed.data;
  // The status is part of incident handling, so agents may set it; everything else is management.
  const me = agentMayUpdateField(field) ? await requireAgentUser() : await requireManager();
  if (!me) return;

  const isRelation = field.endsWith("Id");
  const v = isRelation && (value === "none" || value === "") ? null : value;

  // Validate the String-backed "enum" against lib/constants.ts and verify a
  // relation FK actually exists before writing it (mirrors updateAssetField /
  // updateTicketField) so a forged POST can't corrupt enum data or dangle an FK.
  if (field === "status" && !SERVICE_STATUSES.includes(v as (typeof SERVICE_STATUSES)[number])) return;
  if (field === "criticality" && !CRITICALITIES.includes(v as (typeof CRITICALITIES)[number])) return;
  if (isRelation && v) {
    const relExists: Record<string, () => Promise<boolean>> = {
      categoryId: async () => !!(await db.category.findUnique({ where: { id: v }, select: { id: true } })),
      ownerId: async () => !!(await db.user.findUnique({ where: { id: v }, select: { id: true } })),
      slaId: async () => !!(await db.sLA.findUnique({ where: { id: v }, select: { id: true } })),
      groupId: async () => !!(await db.group.findUnique({ where: { id: v }, select: { id: true } })),
    };
    const check = relExists[field];
    if (check && !(await check())) return;
  }

  await db.service.update({ where: { id }, data: { [field]: v } });
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Service",
    entityId: id,
    summary: `Updated ${field}`,
  });
  revalidatePath(`/services/${id}`);
  revalidatePath("/services");
}

// ── Edit name, code, description, icon ───────────────────────────────────────
// The 6 relation/enum fields are edited inline via updateServiceField; this
// covers the free-text fields the inline editor can't reach.

const detailsSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2, "Name must be at least 2 characters"),
  code: optionalCode,
  description: z.string().default(""),
  icon: optionalIcon,
});

export async function updateService(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const me = await requireManager();
  if (!me) return { error: "Not authorised" };

  const parsed = detailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { id, name, code, description, icon } = parsed.data;

  try {
    await db.service.update({ where: { id }, data: { name, code, description, icon } });
  } catch (e) {
    // Name and code are unique — surface a clean field error instead of a 500.
    const fieldError = uniqueFieldError(e);
    if (fieldError) return fieldError;
    throw e;
  }

  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Service",
    entityId: id,
    summary: `Updated service details`,
  });
  revalidatePath(`/services/${id}`);
  revalidatePath("/services");
}

// ── Supporting CIs (service ↔ asset) ─────────────────────────────────────────

const NOT_AUTHORISED = "Managing services needs a manager or admin.";
const refused = (error: string): ActionResult => ({ ok: false, error });

/** Attach an asset to a service as a supporting configuration item. Idempotent. */
export async function linkServiceAsset(formData: FormData): Promise<ActionResult> {
  const me = await requireManager();
  if (!me) return refused(NOT_AUTHORISED);
  const serviceId = String(formData.get("serviceId") ?? "").trim();
  const assetId = String(formData.get("assetId") ?? "").trim();
  if (!serviceId || !assetId) return refused("Choose an asset.");

  const [service, asset] = await Promise.all([
    db.service.findUnique({ where: { id: serviceId }, select: { name: true } }),
    db.asset.findUnique({ where: { id: assetId }, select: { name: true } }),
  ]);
  if (!service) return refused("Service not found.");
  if (!asset) return refused("Asset not found.");

  await db.serviceAsset.upsert({
    where: { serviceId_assetId: { serviceId, assetId } },
    create: { serviceId, assetId },
    update: {},
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Service", entityId: serviceId, summary: `Added supporting CI "${asset.name}"` });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Asset", entityId: assetId, summary: `Added to service "${service.name}"` });
  revalidatePath(`/services/${serviceId}`);
  revalidatePath(`/assets/${assetId}`);
  return { ok: true };
}

export async function unlinkServiceAsset(formData: FormData): Promise<ActionResult> {
  const me = await requireManager();
  if (!me) return refused(NOT_AUTHORISED);
  const serviceId = String(formData.get("serviceId") ?? "").trim();
  const assetId = String(formData.get("assetId") ?? "").trim();
  if (!serviceId || !assetId) return refused("Missing link.");

  const row = await db.serviceAsset.findUnique({
    where: { serviceId_assetId: { serviceId, assetId } },
    select: { service: { select: { name: true } }, asset: { select: { name: true } } },
  });
  // An already-removed row is a benign no-op.
  if (!row) return { ok: true };

  await db.serviceAsset.delete({ where: { serviceId_assetId: { serviceId, assetId } } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Service", entityId: serviceId, summary: `Removed supporting CI "${row.asset.name}"` });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Asset", entityId: assetId, summary: `Removed from service "${row.service.name}"` });
  revalidatePath(`/services/${serviceId}`);
  revalidatePath(`/assets/${assetId}`);
  return { ok: true };
}

// ── Service dependencies (service → service) ─────────────────────────────────

/** The refusal's message for the UI: the cycle path when there is one. */
function refusalText(e: ServiceWriteRefused): string {
  const detail = (e.refusal.details?.depends_on as string[] | undefined)?.[0];
  return detail ?? e.refusal.message;
}

/**
 * Record that a service depends on another one, with an optional note.
 * Re-adding an existing dependency only updates its note. Refuses a
 * self-dependency and any dependency that would close a cycle (the same rule as
 * the API, lib/service-graph-rules.ts).
 */
export async function addServiceDependency(formData: FormData): Promise<ActionResult> {
  const me = await requireManager();
  if (!me) return refused(NOT_AUTHORISED);
  const serviceId = String(formData.get("serviceId") ?? "").trim();
  const toServiceId = String(formData.get("toServiceId") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  if (!serviceId || !toServiceId) return refused("Choose a service.");
  if (serviceId === toServiceId) return refused("A service cannot depend on itself.");

  const [from, to] = await Promise.all([
    db.service.findUnique({ where: { id: serviceId }, select: { name: true } }),
    db.service.findUnique({ where: { id: toServiceId }, select: { name: true } }),
  ]);
  if (!from || !to) return refused("Service not found.");

  try {
    await saveDependency(serviceId, toServiceId, note);
  } catch (e) {
    if (e instanceof ServiceWriteRefused) return refused(refusalText(e));
    throw e;
  }
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Service", entityId: serviceId, summary: `Depends on "${to.name}"` });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Service", entityId: toServiceId, summary: `Used by "${from.name}"` });
  revalidatePath(`/services/${serviceId}`);
  revalidatePath(`/services/${toServiceId}`);
  return { ok: true };
}

/** Change the note of an existing dependency (the cycle check is moot: the edge exists already). */
export async function updateDependencyNote(formData: FormData): Promise<ActionResult> {
  const me = await requireManager();
  if (!me) return refused(NOT_AUTHORISED);
  const serviceId = String(formData.get("serviceId") ?? "").trim();
  const toServiceId = String(formData.get("toServiceId") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  const row = await db.serviceDependency.findUnique({
    where: { fromServiceId_toServiceId: { fromServiceId: serviceId, toServiceId } },
    select: { note: true, toService: { select: { name: true } } },
  });
  if (!row) return refused("Missing link.");
  if (row.note === note) return { ok: true };
  await db.serviceDependency.update({ where: { fromServiceId_toServiceId: { fromServiceId: serviceId, toServiceId } }, data: { note } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Service", entityId: serviceId, summary: `Updated note of dependency on "${row.toService.name}"` });
  revalidatePath(`/services/${serviceId}`);
  revalidatePath(`/services/${toServiceId}`);
  return { ok: true };
}

export async function removeServiceDependency(formData: FormData): Promise<ActionResult> {
  const me = await requireManager();
  if (!me) return refused(NOT_AUTHORISED);
  const serviceId = String(formData.get("serviceId") ?? "").trim();
  const toServiceId = String(formData.get("toServiceId") ?? "").trim();
  if (!serviceId || !toServiceId) return refused("Missing link.");

  const row = await db.serviceDependency.findUnique({
    where: { fromServiceId_toServiceId: { fromServiceId: serviceId, toServiceId } },
    select: { fromService: { select: { name: true } }, toService: { select: { name: true } } },
  });
  // An already-removed row is a benign no-op.
  if (!row) return { ok: true };

  await db.serviceDependency.delete({ where: { fromServiceId_toServiceId: { fromServiceId: serviceId, toServiceId } } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Service", entityId: serviceId, summary: `No longer depends on "${row.toService.name}"` });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Service", entityId: toServiceId, summary: `No longer used by "${row.fromService.name}"` });
  revalidatePath(`/services/${serviceId}`);
  revalidatePath(`/services/${toServiceId}`);
  return { ok: true };
}

// ── Delete ───────────────────────────────────────────────────────────────────
// Like the REST API, a service that is still referenced (tickets, catalog items,
// dependent services, ...) is not deleted: the answer suggests status RETIRED
// (lib/service-records.ts serviceReferences). Its own CI links and dependencies
// go with it. Redirects to the list on success.

export async function deleteService(formData: FormData): Promise<ActionResult | void> {
  const me = await requireManager();
  if (!me) return refused(NOT_AUTHORISED);
  const id = String(formData.get("id") ?? "");
  const service = await db.service.findUnique({
    where: { id },
    select: { name: true, usedBy: { select: { fromServiceId: true } }, dependsOn: { select: { toServiceId: true } } },
  });
  if (!service) return;
  // Same rule as the API: a referenced service is retired, not deleted.
  const inUse = inUseRefusal(await serviceReferences(id));
  if (inUse) return refused(inUse.message);
  // The polymorphic Approval has no FK to Service — clean its rows so the
  // /approvals queue doesn't fill with dangling, still-actionable sign-offs.
  await db.approval.deleteMany({ where: { entityType: "SERVICE", entityId: id } });
  await db.service.delete({ where: { id } });
  await writeAudit({
    userId: me.id,
    action: "DELETE",
    entity: "Service",
    entityId: id,
    summary: `Deleted service "${service.name}"`,
  });
  // The services on the other end of a removed dependency keep a trace of it.
  const neighbours = new Set([...service.usedBy.map((d) => d.fromServiceId), ...service.dependsOn.map((d) => d.toServiceId)]);
  for (const other of neighbours) {
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "Service", entityId: other, summary: `Dependency on deleted service "${service.name}" removed` });
    revalidatePath(`/services/${other}`);
  }
  revalidatePath("/services");
  redirect("/services");
}
