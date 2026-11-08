import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Categories the self-service portal offers: not archived and not staff-only.
 * Staff-only categories (e.g. monitoring or security alerts) stay usable in the
 * console and the API.
 */
export const PORTAL_CATEGORY_WHERE = { archived: false, portalHidden: false } satisfies Prisma.CategoryWhereInput;

/** Catalog items the portal lists: published, and not filed under a staff-only category. */
export const PORTAL_CATALOG_ITEM_WHERE = {
  isPublished: true,
  NOT: { category: { is: { portalHidden: true } } },
} satisfies Prisma.CatalogItemWhereInput;

/**
 * Whether making `parentId` the parent of category `id` would close a cycle: the
 * category itself, or one of its descendants, sits on the parent's ancestor chain.
 */
export async function parentCreatesCycle(id: string, parentId: string): Promise<boolean> {
  let cursor: string | null = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === id) return true;
    if (seen.has(cursor)) return false; // pre-existing cycle: stop, don't loop forever
    seen.add(cursor);
    const node: { parentId: string | null } | null = await db.category.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    cursor = node?.parentId ?? null;
  }
  return false;
}

