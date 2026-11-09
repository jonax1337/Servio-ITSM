"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, hasRole, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { MAX_TITLE_LEN, catalogTicketType, parseApprovalStages } from "@/lib/service-forms";
import { catalogQuestionsSchema, questionsJson } from "@/lib/api-catalog-input";
import { APPROVAL_WITHOUT_APPROVER, catalogReferenceError, checkApprovalStages, isActiveAgent } from "@/lib/catalog-items";

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

/** The posted form definition, checked like an API body (keys, options, conditions). */
function parseQuestions(formData: FormData): { formSchema: string } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("formSchema") ?? "[]"));
  } catch {
    raw = [];
  }
  const parsed = catalogQuestionsSchema.safeParse(Array.isArray(raw) ? raw : []);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the request form." };
  return { formSchema: questionsJson(parsed.data) };
}

async function payload(formData: FormData, approverId: string | null, approvalStages: string | null, formSchema: string) {
  const days = parseInt(String(formData.get("estimatedDays") ?? ""), 10);
  return {
    name: String(formData.get("name")).trim(),
    description: opt(formData.get("description")),
    shortDescription: opt(formData.get("shortDescription")),
    icon: opt(formData.get("icon")),
    categoryId: rel(formData.get("categoryId")),
    serviceId: rel(formData.get("serviceId")),
    groupId: rel(formData.get("groupId")),
    estimatedDays: Number.isFinite(days) ? days : null,
    isPublished: formData.get("isPublished") !== "false",
    requiresApproval: formData.get("requiresApproval") === "true",
    approverId,
    approvalStages,
    formSchema,
    ticketType: catalogTicketType(String(formData.get("ticketType") ?? "")),
    titleTemplate: opt(formData.get("titleTemplate"))?.slice(0, MAX_TITLE_LEN) ?? null,
  };
}

async function validApprover(formData: FormData) {
  const raw = rel(formData.get("approverId"));
  if (!raw) return null;
  return (await isActiveAgent(raw)) ? raw : null;
}

/** Validate + normalise the ORDERED approval stages posted by the editor (see checkApprovalStages). */
function validApprovalStages(formData: FormData) {
  return checkApprovalStages(parseApprovalStages(String(formData.get("approvalStages") ?? "")));
}

/** Everything the item editor posts, validated: the Prisma data or the first error. */
async function itemPayload(formData: FormData): Promise<{ data: Awaited<ReturnType<typeof payload>> } | { error: string }> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid" };
  const questions = parseQuestions(formData);
  if ("error" in questions) return questions;
  const approverId = await validApprover(formData);
  const stagesResult = await validApprovalStages(formData);
  if ("error" in stagesResult) return { error: stagesResult.error };
  // With stages configured, mirror stage 0's concrete approver into approverId
  // (display only; requests are routed by the stages themselves).
  const effectiveApproverId = stagesResult.stages ? stagesResult.fallbackApproverId : approverId;
  const data = await payload(formData, effectiveApproverId, stagesResult.stages, questions.formSchema);
  if (data.requiresApproval && !effectiveApproverId && !data.approvalStages) return { error: APPROVAL_WITHOUT_APPROVER };
  const missing = await catalogReferenceError(data);
  if (missing) return { error: missing.message };
  return { data };
}

export async function createCatalogItem(_prev: CatalogAdminState, formData: FormData): Promise<CatalogAdminState> {
  const me = await requireManager();
  if (!me) return { error: "Not authorised" };
  const result = await itemPayload(formData);
  if ("error" in result) return { error: result.error };
  const count = await db.catalogItem.count();
  const item = await db.catalogItem.create({ data: { ...result.data, order: count } });
  await writeAudit({ userId: me.id, action: "CREATE", entity: "CatalogItem", entityId: item.id, summary: `Created catalog item "${item.name}"` });
  revalidatePath("/catalog");
  return undefined;
}

export async function updateCatalogItem(_prev: CatalogAdminState, formData: FormData): Promise<CatalogAdminState> {
  const me = await requireManager();
  if (!me) return { error: "Not authorised" };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing id" };
  const result = await itemPayload(formData);
  if ("error" in result) return { error: result.error };
  await db.catalogItem.update({ where: { id }, data: result.data });
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
      // Keep approverId mirroring stage 0 (its concrete approver); requests are routed
      // by the stages. Restore the single approver when stages are cleared.
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
