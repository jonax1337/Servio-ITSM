import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, pageMeta, paginate, preflight } from "@/lib/api";
import { CATALOG_ITEM_INCLUDE, catalogItemCreateSchema, serializeCatalogItem } from "@/lib/api-catalog-input";
import { agentGuard, readBody } from "../_itsm";
import { importRefTaken, managerOnly } from "../_manage";
import { CATALOG_WHAT, catalogItemResponse, catalogWriteConflict, createCatalogItemRecord, prepareCatalogItem } from "../_catalog-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * Service catalog items with their request forms. Filters: `q` (name), `category_id`,
 * `service_id`, `group_id`, `published` (true | false, default both). Ordered like the catalog. Each item
 * carries `visible_to_group_ids` / `restricted` (who may see it in the portal).
 */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "catalog:read");
  if ("response" in auth) return auth.response;
  const p = new URL(req.url).searchParams;
  const { page, perPage, skip, take } = paginate(p);
  const where: Prisma.CatalogItemWhereInput = {};
  if (p.get("q")) where.name = { contains: p.get("q")! };
  if (p.get("category_id")) where.categoryId = p.get("category_id")!;
  if (p.get("service_id")) where.serviceId = p.get("service_id")!;
  if (p.get("group_id")) where.groupId = p.get("group_id")!;
  const published = p.get("published");
  if (published === "true" || published === "false") where.isPublished = published === "true";
  const [total, rows] = await Promise.all([
    db.catalogItem.count({ where }),
    db.catalogItem.findMany({ where, orderBy: [{ order: "asc" }, { name: "asc" }], skip, take, include: CATALOG_ITEM_INCLUDE }),
  ]);
  return ok(rows.map(serializeCatalogItem), { meta: pageMeta(page, perPage, total) });
}

/** Create a catalog item (MANAGER+). An `import_ref` already in use is a 409 with the existing `id`. */
export async function POST(req: Request) {
  const auth = await agentGuard(req, "catalog:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, CATALOG_WHAT);
  if (refused) return refused;
  const body = await readBody(req, catalogItemCreateSchema);
  if ("response" in body) return body.response;
  if (body.data.import_ref) {
    const taken = await db.catalogItem.findUnique({ where: { importRef: body.data.import_ref }, select: { id: true } });
    if (taken) return importRefTaken(taken.id);
  }
  const prepared = await prepareCatalogItem(body.data, null);
  if ("response" in prepared) return prepared.response;

  try {
    const item = await createCatalogItemRecord({ ...prepared.data, name: body.data.name }, prepared.groupIds, auth.principal.userId, "API");
    return catalogItemResponse(item, { status: 201 });
  } catch (err) {
    return catalogWriteConflict(err);
  }
}
