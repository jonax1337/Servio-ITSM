import { db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { parentCreatesCycle } from "@/lib/categories";
import type { CategoryPatch } from "@/lib/api-category-input";

/** Shared plumbing of POST /categories and PATCH /categories/{id}. */

export const CATEGORY_SELECT = {
  id: true, name: true, description: true, icon: true, color: true, parentId: true, groupId: true, archived: true, portalHidden: true,
} as const;

export function serializeCategory(c: {
  id: string; name: string; description: string | null; icon: string | null; color: string;
  parentId: string | null; groupId: string | null; archived: boolean; portalHidden: boolean;
}) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    icon: c.icon,
    color: c.color,
    parent_id: c.parentId,
    group_id: c.groupId,
    archived: c.archived,
    portal_hidden: c.portalHidden,
  };
}

/**
 * 422 for a parent or group that does not exist or a parent that would close a
 * cycle; 409 for a name already used under the same parent. `current` is the
 * category being edited (absent on create).
 */
export async function categoryWriteErrors(b: CategoryPatch, current?: { id: string; name: string; parentId: string | null }) {
  if (b.parent_id) {
    if (!(await db.category.findUnique({ where: { id: b.parent_id }, select: { id: true } }))) {
      return apiError(422, "Validation failed", { parent_id: [`Unknown category: ${b.parent_id}`] });
    }
    if (current && (await parentCreatesCycle(current.id, b.parent_id))) {
      return apiError(422, "Validation failed", { parent_id: ["A category cannot sit under itself or one of its subcategories."] });
    }
  }
  if (b.group_id && !(await db.group.findUnique({ where: { id: b.group_id }, select: { id: true } }))) {
    return apiError(422, "Validation failed", { group_id: [`Unknown group: ${b.group_id}`] });
  }
  // Checked here because the unique index treats every top-level (NULL parent) row as distinct.
  const name = b.name ?? current?.name;
  const parentId = b.parent_id === undefined ? (current?.parentId ?? null) : b.parent_id;
  const clash = name
    ? await db.category.findFirst({ where: { name, parentId, ...(current && { id: { not: current.id } }) }, select: { id: true } })
    : null;
  if (clash) return apiError(409, DUPLICATE_NAME, { id: clash.id });
  return null;
}

export const DUPLICATE_NAME = "A category with this name already exists under the same parent.";

/** A unique-index race lost to a concurrent writer. */
export const isDuplicateName = (e: unknown) => (e as { code?: string })?.code === "P2002";
