import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiError, ok } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import {
  CATALOG_FIELD_RENAMES, CATALOG_ITEM_INCLUDE, catalogItemData, serializeCatalogItem, visibleGroupIdsOf,
  type CatalogItemPatch, type CatalogItemRow,
} from "@/lib/api-catalog-input";
import { apiFieldNames, changedColumns } from "@/lib/api-record-diff";
import {
  APPROVAL_WITHOUT_APPROVER, catalogReferenceError, checkApprovalStages, isActiveAgent, setCatalogItemGroups, unknownGroupIds,
} from "@/lib/catalog-items";
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
 * is mirrored into approverId as in the console editor. `groupIds` is the new set of groups the
 * item is visible to (deduplicated; undefined = left as it is, [] = restriction lifted); an unknown
 * group is a 422.
 */
export async function prepareCatalogItem(
  b: Partial<CatalogItemPatch>,
  current: CatalogItemRow | null,
): Promise<{ data: Data; groupIds: string[] | undefined } | { response: ReturnType<typeof apiError> }> {
  const data: Data = catalogItemData(b);
  const groupIds = b.visible_to_group_ids === undefined ? undefined : [...new Set(b.visible_to_group_ids)];
  if (groupIds && (await unknownGroupIds(groupIds)).length > 0) {
    return { response: apiError(422, "Validation failed", { visible_to_group_ids: ["Group not found."] }) };
  }
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
  return { data, groupIds };
}

/**
 * Create an item (MANAGER+ checked by the caller), restricted to `groupIds` when given and not empty.
 * New items go to the end of the catalog unless `order` is given.
 */
export async function createCatalogItemRecord(data: Data & { name: string }, groupIds: string[] | undefined, actorId: string, via: string) {
  const order = data.order ?? (await db.catalogItem.count());
  const item = await db.$transaction(async (tx) => {
    const created = await tx.catalogItem.create({ data: { ...data, order } as Prisma.CatalogItemUncheckedCreateInput });
    if (groupIds?.length) await setCatalogItemGroups(tx, created.id, groupIds);
    return tx.catalogItem.findUniqueOrThrow({ where: { id: created.id }, include: CATALOG_ITEM_INCLUDE });
  });
  await writeAudit({ userId: actorId, action: "CREATE", entity: "CatalogItem", entityId: item.id, summary: `Created catalog item "${item.name}" via ${via}` });
  revalidatePath("/catalog");
  return item;
}

/** Whether restricting to `groupIds` differs from how `current` is restricted now. */
function groupsDiffer(current: CatalogItemRow, groupIds: string[] | undefined): boolean {
  if (groupIds === undefined) return false;
  if ((groupIds.length > 0) !== current.restrictToGroups) return true;
  const now = new Set(visibleGroupIdsOf(current));
  return groupIds.length !== now.size || groupIds.some((id) => !now.has(id));
}

/**
 * Write what differs from `current` (columns and, when given, the groups the item is visible to) in one
 * transaction; an unchanged body writes nothing and no audit row.
 */
export async function updateCatalogItemRecord(current: CatalogItemRow, data: Data, groupIds: string[] | undefined, actorId: string, via: string) {
  const columns = changedColumns(current, data);
  const groups = groupsDiffer(current, groupIds);
  const changed = [...apiFieldNames(columns, CATALOG_FIELD_RENAMES), ...(groups ? ["visible_to_group_ids"] : [])];
  if (changed.length === 0) return { item: current, changed };
  const patch = Object.fromEntries(columns.map((k) => [k, data[k as keyof Data]]));
  const item = await db.$transaction(async (tx) => {
    if (columns.length > 0) await tx.catalogItem.update({ where: { id: current.id }, data: patch });
    if (groups) await setCatalogItemGroups(tx, current.id, groupIds!);
    return tx.catalogItem.findUniqueOrThrow({ where: { id: current.id }, include: CATALOG_ITEM_INCLUDE });
  });
  await writeAudit({
    userId: actorId, action: "UPDATE", entity: "CatalogItem", entityId: item.id,
    summary: `Updated catalog item "${item.name}" via ${via} (${changed.join(", ")})`,
    meta: { changed, ...(groups && { visibleToGroupIds: visibleGroupIdsOf(item) }) },
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
