"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAgentUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { SERVICE_STATUSES, CRITICALITIES } from "@/lib/constants";
import type { ActionResult } from "@/lib/action-result";

async function requireAgent() {
  // DB-truth guard (role + isActive rehydrated) — see requireAgentUser.
  return requireAgentUser();
}

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" && v !== "" ? v : null));

const optionalIcon = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : null));

const createSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
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

export async function createService(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const me = await requireAgent();
  if (!me) return { error: "Not authorised" };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const service = await db.service.create({ data });

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
  const me = await requireAgent();
  if (!me) return;
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { id, field, value } = parsed.data;

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

// ── Edit name + description ──────────────────────────────────────────────────
// The 6 relation/enum fields are edited inline via updateServiceField; this
// covers the two free-text fields the inline editor can't reach.

const detailsSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2, "Name must be at least 2 characters"),
  description: z.string().default(""),
  icon: optionalIcon,
});

export async function updateService(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const me = await requireAgent();
  if (!me) return { error: "Not authorised" };

  const parsed = detailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { id, name, description, icon } = parsed.data;

  try {
    await db.service.update({ where: { id }, data: { name, description, icon } });
  } catch (e) {
    // Name is unique — surface a clean field error instead of a 500.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "A service with that name already exists.", fieldErrors: { name: ["Name must be unique"] } };
    }
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

const NOT_AUTHORISED = "You are not signed in as an agent.";
const refused = (error: string): ActionResult => ({ ok: false, error });

/** Attach an asset to a service as a supporting configuration item. Idempotent. */
export async function linkServiceAsset(formData: FormData): Promise<ActionResult> {
  const me = await requireAgent();
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
  const me = await requireAgent();
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

// ── Delete ───────────────────────────────────────────────────────────────────
// Tickets and catalog items keep their rows with serviceId=null (the relations
// are optional → Prisma default SetNull), so history and requests aren't
// destroyed. Redirects to the list on success.

export async function deleteService(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const service = await db.service.findUnique({ where: { id }, select: { name: true } });
  if (!service) return;
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
  revalidatePath("/services");
  redirect("/services");
}
