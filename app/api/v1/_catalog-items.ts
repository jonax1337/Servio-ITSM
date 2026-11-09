import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiError, ok } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import {
  CATALOG_FIELD_RENAMES, catalogItemData, serializeCatalogItem, type CatalogItemPatch, type CatalogItemRow,
} from "@/lib/api-catalog-input";
import { apiFieldNames, changedColumns } from "@/lib/api-record-diff";
import { APPROVAL_WITHOUT_APPROVER, catalogReferenceError, checkApprovalStages, isActiveAgent } from "@/lib/catalog-items";
import { importRefTaken, isUniqueOn } from "./_manage";

/** Shared plumbing of the /catalog-items endpoints. */

export const CATALOG_WHAT = "the service catalog";

export function catalogItemNotFound() {
  return apiError(404, "Catalog item not found");
}

type Data = ReturnType<typeof catalogItemData>;

/**
 * Checks a body against the database and the current item (absent on create) and
 * returns the Prisma data to write: 422 for an unknown category, service or team,
 * an approver who is not an active agent, invalid approval stages, or approval
 * required without anyone to approve. With approval stages, the stage-0 approver
 * is mirrored into approverId as in the console editor.
 */
export async function prepareCatalogItem(
  b: Partial<CatalogItemPatch>,
  current: CatalogItemRow | null,
): Promise<{ data: Data } | { response: ReturnType<typeof apiError> }> {
  const data: Data = catalogItemData(b);
  const missing = await catalogReferenceError(data);
  if (missing) return { response: apiError(422, "Validation failed", { [missing.field]: [missing.message] }) };
  if (b.approver_id && !(await isActiveAgent(b.approver_id))) {
    return { response: apiError(422, "Validation failed", { approver_id: ["The approver must be an active agent."] }) };
  }
  if (b.approval_stages !== undefined) {
    const stages = await checkApprovalStages(
      b.approval_stages.map((s) => ({ approverId: s.approver_id ?? null, groupId: s.group_id ?? null })),
    );
    if ("error" in stages) return { response: apiError(422, "Validation failed", { approval_stages: [stages.error] }) };
    data.approvalStages = stages.stages;
    if (stages.stages) data.approverId = stages.fallbackApproverId;
  }
  const requiresApproval = data.requiresApproval ?? current?.requiresApproval ?? false;
  const approverId = data.approverId !== undefined ? data.approverId : (current?.approverId ?? null);
  const approvalStages = data.approvalStages !== undefined ? data.approvalStages : (current?.approvalStages ?? null);
  if (requiresApproval && !approverId && !approvalStages) {
    return { response: apiError(422, "Validation failed", { requires_approval: [APPROVAL_WITHOUT_APPROVER] }) };
  }
  return { data };
}

/** Create an item (MANAGER+ checked by the caller). New items go to the end of the catalog unless `order` is given. */
export async function createCatalogItemRecord(data: Data & { name: string }, actorId: string, via: string) {
  const order = data.order ?? (await db.catalogItem.count());
  const item = await db.catalogItem.create({ data: { ...data, order } as Prisma.CatalogItemUncheckedCreateInput });
  await writeAudit({ userId: actorId, action: "CREATE", entity: "CatalogItem", entityId: item.id, summary: `Created catalog item "${item.name}" via ${via}` });
  revalidatePath("/catalog");
  return item;
}

/** Write the columns that differ from `current`; an unchanged body writes nothing and no audit row. */
export async function updateCatalogItemRecord(current: CatalogItemRow, data: Data, actorId: string, via: string) {
  const columns = changedColumns(current, data);
  const changed = apiFieldNames(columns, CATALOG_FIELD_RENAMES);
  if (columns.length === 0) return { item: current, changed };
  const patch = Object.fromEntries(columns.map((k) => [k, data[k as keyof Data]]));
  const item = await db.catalogItem.update({ where: { id: current.id }, data: patch });
  await writeAudit({
    userId: actorId, action: "UPDATE", entity: "CatalogItem", entityId: item.id,
    summary: `Updated catalog item "${item.name}" via ${via} (${changed.join(", ")})`, meta: { changed },
  });
  revalidatePath("/catalog");
  return { item, changed };
}

export function catalogItemResponse(item: CatalogItemRow, init?: { status?: number; meta?: unknown }) {
  return ok(serializeCatalogItem(item), init);
}

/** 409 when a write lost the race for an import_ref; otherwise rethrows. */
export function catalogWriteConflict(err: unknown) {
  if (isUniqueOn(err, "importRef")) return importRefTaken();
  throw err;
}
