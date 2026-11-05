"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, isAgent, hasRole, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { parseApprovalStages, serializeApprovalStages, type ApprovalStage } from "@/lib/service-forms";

// DB-truth (not the stale JWT): role/isActive rehydrate from the user row so a
// demoted/deactivated manager loses write access immediately.
async function requireManager() {
  const me = await getCurrentUser();
  return me && me.isActive && hasRole(me.role as Role, "MANAGER") ? me : null;
}

const opt = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};
const rel = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s && s !== "none" ? s : null;
};

const schema = z.object({ name: z.string().min(2, "Name is required") });

export type CatalogAdminState = { error?: string } | undefined;

async function payload(formData: FormData, approverId: string | null, approvalStages: string | null) {
  let formSchema = "[]";
  try {
    const a = JSON.parse(String(formData.get("formSchema") ?? "[]"));
    formSchema = JSON.stringify(Array.isArray(a) ? a : []);
  } catch { formSchema = "[]"; }
  const days = parseInt(String(formData.get("estimatedDays") ?? ""), 10);
  return {
    name: String(formData.get("name")).trim(),
    description: opt(formData.get("description")),
    shortDescription: opt(formData.get("shortDescription")),
    icon: opt(formData.get("icon")),
    categoryId: rel(formData.get("categoryId")),
    serviceId: rel(formData.get("serviceId")),
    estimatedDays: Number.isFinite(days) ? days : null,
    isPublished: formData.get("isPublished") !== "false",
    requiresApproval: formData.get("requiresApproval") === "true",
    approverId,
    approvalStages,
    formSchema,
  };
}

async function isActiveAgent(id: string) {
  const u = await db.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
  return !!(u && u.isActive && isAgent(u.role as Role));
}

async function validApprover(formData: FormData) {
  const raw = rel(formData.get("approverId"));
  if (!raw) return null;
  return (await isActiveAgent(raw)) ? raw : null;
}

/** Pick a concrete active-agent id for a stage (used as the stage-0 fallback so
 *  the portal-tickets approver guard passes for group-first items). */
async function stageApproverId(s: ApprovalStage): Promise<string | null> {
  if (s.approverId) return (await isActiveAgent(s.approverId)) ? s.approverId : null;
  if (s.groupId) {
    const m = await db.groupMember.findFirst({
      where: { groupId: s.groupId, user: { isActive: true, role: { in: ["ADMIN", "MANAGER", "AGENT"] } } },
      select: { userId: true },
      orderBy: [{ role: "asc" }],
    });
    return m?.userId ?? null;
  }
  return null;
}

/**
 * Validate + normalise the ORDERED approval stages posted by the editor. Each
 * stage names an active-agent approver OR a real group. Returns the serialised
 * JSON (or null for no stages) plus a resolved stage-0 `fallbackApproverId`
 * (kept in CatalogItem.approverId so the single-approver guard in portal-tickets
 * passes and seats a stage-0 approval we then reconcile), or an error string.
 */
async function validApprovalStages(
  formData: FormData,
): Promise<{ stages: string | null; fallbackApproverId: string | null } | { error: string }> {
  const stages = parseApprovalStages(String(formData.get("approvalStages") ?? ""));
  const clean: ApprovalStage[] = [];
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i];
    if (s.approverId) {
      if (!(await isActiveAgent(s.approverId))) {
        return { error: `Stage ${i + 1}: the selected approver is not an active agent.` };
      }
      clean.push({ approverId: s.approverId });
    } else if (s.groupId) {
      const group = await db.group.findUnique({ where: { id: s.groupId }, select: { id: true } });
      if (!group) return { error: `Stage ${i + 1}: the selected group no longer exists.` };
      const memberCount = await db.groupMember.count({
        where: { groupId: s.groupId, user: { isActive: true, role: { in: ["ADMIN", "MANAGER", "AGENT"] } } },
      });
      if (memberCount === 0) return { error: `Stage ${i + 1}: the selected group has no active agents to approve.` };
      clean.push({ groupId: s.groupId });
    } else {
      return { error: `Stage ${i + 1}: choose an approver or a group.` };
    }
  }
  const fallbackApproverId = clean.length > 0 ? await stageApproverId(clean[0]) : null;
  return { stages: serializeApprovalStages(clean), fallbackApproverId };
}

export async function createCatalogItem(_prev: CatalogAdminState, formData: FormData): Promise<CatalogAdminState> {
  const me = await requireManager();
  if (!me) return { error: "Not authorised" };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid" };
  const approverId = await validApprover(formData);
  const stagesResult = await validApprovalStages(formData);
  if ("error" in stagesResult) return { error: stagesResult.error };
  // With stages configured, mirror stage 0's concrete approver into approverId so
  // the single-approver seat in portal-tickets fires (we then reconcile it).
  const effectiveApproverId = stagesResult.stages ? stagesResult.fallbackApproverId : approverId;
  const data = await payload(formData, effectiveApproverId, stagesResult.stages);
  if (data.requiresApproval && !effectiveApproverId && !data.approvalStages) {
    return { error: "Approval is required for this item, but no approver or approval stage was configured." };
  }
  const count = await db.catalogItem.count();
  const item = await db.catalogItem.create({ data: { ...data, order: count } });
  await writeAudit({ userId: me.id, action: "CREATE", entity: "CatalogItem", entityId: item.id, summary: `Created catalog item "${item.name}"` });
  revalidatePath("/catalog");
  return undefined;
}

export async function updateCatalogItem(_prev: CatalogAdminState, formData: FormData): Promise<CatalogAdminState> {
  const me = await requireManager();
  if (!me) return { error: "Not authorised" };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing id" };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid" };
  const approverId = await validApprover(formData);
  const stagesResult = await validApprovalStages(formData);
  if ("error" in stagesResult) return { error: stagesResult.error };
  const effectiveApproverId = stagesResult.stages ? stagesResult.fallbackApproverId : approverId;
  const data = await payload(formData, effectiveApproverId, stagesResult.stages);
  if (data.requiresApproval && !effectiveApproverId && !data.approvalStages) {
    return { error: "Approval is required for this item, but no approver or approval stage was configured." };
  }
  await db.catalogItem.update({ where: { id }, data });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "CatalogItem", entityId: id, summary: "Updated catalog item" });
  revalidatePath("/catalog");
  return undefined;
}

/**
 * Save ONLY the ordered approval stages for an item (from the dedicated stage
 * editor). Setting one or more valid stages turns on requiresApproval; clearing
 * them leaves the item's single-approver config intact.
 */
export async function updateApprovalStages(_prev: CatalogAdminState, formData: FormData): Promise<CatalogAdminState> {
  const me = await requireManager();
  if (!me) return { error: "Not authorised" };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing id" };
  const item = await db.catalogItem.findUnique({ where: { id }, select: { approverId: true } });
  if (!item) return { error: "Item not found" };

  const stagesResult = await validApprovalStages(formData);
  if ("error" in stagesResult) return { error: stagesResult.error };

  await db.catalogItem.update({
    where: { id },
    data: {
      approvalStages: stagesResult.stages,
      // Any configured stage implies approval; with no stages fall back to the
      // single approver (only require approval if one is set).
      requiresApproval: stagesResult.stages ? true : !!item.approverId,
      // Keep approverId mirroring stage 0 (its concrete approver) so the portal
      // seat guard passes; restore the single approver when stages are cleared.
      approverId: stagesResult.stages ? stagesResult.fallbackApproverId : item.approverId,
    },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "CatalogItem", entityId: id, summary: "Updated approval stages" });
  revalidatePath("/catalog");
  return undefined;
}

export async function toggleCatalogPublished(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const item = await db.catalogItem.findUnique({ where: { id } });
  if (!item) return;
  await db.catalogItem.update({ where: { id }, data: { isPublished: !item.isPublished } });
  revalidatePath("/catalog");
}

export async function deleteCatalogItem(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  // deleteMany: no throw when the item is already gone; skip revalidate on a no-op.
  const item = await db.catalogItem.findUnique({ where: { id }, select: { name: true } });
  const gone = await db.catalogItem.deleteMany({ where: { id } }).catch(() => null);
  if (!gone || gone.count === 0) return;
  await writeAudit({ userId: me.id, action: "DELETE", entity: "CatalogItem", entityId: id, summary: `Deleted catalog item "${item?.name ?? id}"` });
  revalidatePath("/catalog");
}
