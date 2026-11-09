import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { PORTAL_CATALOG_ITEM_WHERE } from "@/lib/categories";

/**
 * Who may see and request a catalog item. An item is either open to everyone
 * (`restrictToGroups` false, the default) or restricted to the members of the
 * groups listed in `CatalogItemGroup`. The rule is applied on the server wherever
 * the portal lists, finds, describes or orders an item - never only in the UI.
 *
 * A restricted item whose listed groups were all deleted stays restricted and is
 * then visible to nobody (fail closed): deleting a group must not publish the item.
 */

/** Prisma filter: the items `userId` may see, through membership of a listed group. */
export function catalogVisibleToWhere(userId: string): Prisma.CatalogItemWhereInput {
  return {
    OR: [
      { restrictToGroups: false },
      { visibleTo: { some: { group: { members: { some: { userId } } } } } },
    ],
  };
}

/**
 * The portal's catalog filter for one user: published, not filed under a staff-only
 * category, and visible to them. Spread it into a `where` and add search terms under
 * `OR` as before - the visibility rule sits under `AND`, so it cannot be overridden.
 */
export function portalCatalogItemWhere(userId: string) {
  return { ...PORTAL_CATALOG_ITEM_WHERE, AND: [catalogVisibleToWhere(userId)] } satisfies Prisma.CatalogItemWhereInput;
}

/** Whether `userId` may see (and so request) the item - false for a missing id as well. */
export async function canSeeCatalogItem(itemId: string, userId: string): Promise<boolean> {
  const hit = await db.catalogItem.findFirst({ where: { id: itemId, ...catalogVisibleToWhere(userId) }, select: { id: true } });
  return hit !== null;
}
