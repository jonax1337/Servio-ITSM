import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isAgent, type Role } from "@/lib/session";
import { serializeApprovalStages, type ApprovalStage } from "@/lib/service-forms";

/**
 * Catalog item checks that need the database, shared by the console's catalog
 * editor (lib/actions/catalog-admin.ts) and the /api/v1/catalog-items endpoints.
 */

const AGENT_ROLES = ["ADMIN", "MANAGER", "AGENT"];

export async function isActiveAgent(id: string) {
  const u = await db.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
  return !!(u && u.isActive && isAgent(u.role as Role));
}

/** A concrete active-agent id for a stage: its named approver, or a group's first active agent. */
async function stageApproverId(s: ApprovalStage): Promise<string | null> {
  if (s.approverId) return (await isActiveAgent(s.approverId)) ? s.approverId : null;
  if (s.groupId) {
    const m = await db.groupMember.findFirst({
      where: { groupId: s.groupId, user: { isActive: true, role: { in: AGENT_ROLES } } },
      select: { userId: true },
      orderBy: [{ role: "asc" }],
    });
    return m?.userId ?? null;
  }
  return null;
}

/**
 * Validate ORDERED approval stages: each names an active-agent approver or a group
 * with at least one active agent. Returns the stored JSON (null for no stages) and
 * the stage-0 approver that is mirrored into CatalogItem.approverId for display
 * (requests are routed by the stages themselves), or an error naming the stage.
 */
export async function checkApprovalStages(
  stages: ApprovalStage[],
): Promise<{ stages: string | null; fallbackApproverId: string | null } | { error: string }> {
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
        where: { groupId: s.groupId, user: { isActive: true, role: { in: AGENT_ROLES } } },
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

export const APPROVAL_WITHOUT_APPROVER =
  "Approval is required for this item, but no approver or approval stage was configured.";

/** The ids among `groupIds` that are no group (deduplicated input expected). */
export async function unknownGroupIds(groupIds: string[]): Promise<string[]> {
  if (groupIds.length === 0) return [];
  const found = await db.group.findMany({ where: { id: { in: groupIds } }, select: { id: true } });
  const known = new Set(found.map((g) => g.id));
  return groupIds.filter((id) => !known.has(id));
}

/**
 * Replace the groups an item is visible to. An empty list lifts the restriction;
 * otherwise the item is restricted to exactly these groups. Callers validate the ids
 * first (`unknownGroupIds`) and own the transaction, if any.
 */
export async function setCatalogItemGroups(
  client: Prisma.TransactionClient,
  itemId: string,
  groupIds: string[],
) {
  await client.catalogItemGroup.deleteMany({ where: { catalogItemId: itemId } });
  if (groupIds.length > 0) {
    await client.catalogItemGroup.createMany({ data: groupIds.map((groupId) => ({ catalogItemId: itemId, groupId })) });
  }
  await client.catalogItem.update({ where: { id: itemId }, data: { restrictToGroups: groupIds.length > 0 } });
}

/** The field (snake_case) and message of the first category, service or team that does not exist, or null. */
export async function catalogReferenceError(refs: {
  categoryId?: string | null;
  serviceId?: string | null;
  groupId?: string | null;
}): Promise<{ field: string; message: string } | null> {
  const [category, service, group] = await Promise.all([
    refs.categoryId ? db.category.findUnique({ where: { id: refs.categoryId }, select: { id: true } }) : true,
    refs.serviceId ? db.service.findUnique({ where: { id: refs.serviceId }, select: { id: true } }) : true,
    refs.groupId ? db.group.findUnique({ where: { id: refs.groupId }, select: { id: true } }) : true,
  ]);
  if (!category) return { field: "category_id", message: "Category not found." };
  if (!service) return { field: "service_id", message: "Service not found." };
  if (!group) return { field: "group_id", message: "Team not found." };
  return null;
}
