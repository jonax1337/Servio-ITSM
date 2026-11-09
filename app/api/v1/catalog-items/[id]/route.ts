import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { catalogItemPatchSchema } from "@/lib/api-catalog-input";
import { agentGuard, readBody } from "../../_itsm";
import { importRefTaken, managerOnly } from "../../_manage";
import {
  CATALOG_WHAT, catalogItemNotFound, catalogItemResponse, catalogWriteConflict, prepareCatalogItem, updateCatalogItemRecord,
} from "../../_catalog-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "read");
  if ("response" in auth) return auth.response;
  const item = await db.catalogItem.findUnique({ where: { id: (await ctx.params).id } });
  if (!item) return catalogItemNotFound();
  return catalogItemResponse(item);
}

/**
 * Edit a catalog item (MANAGER+). Fields left out keep their value, `null` clears
 * a nullable one, `questions` replaces the whole form. `meta.changed` lists what
 * changed; an unchanged body writes nothing.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, CATALOG_WHAT);
  if (refused) return refused;
  const current = await db.catalogItem.findUnique({ where: { id: (await ctx.params).id } });
  if (!current) return catalogItemNotFound();
  const body = await readBody(req, catalogItemPatchSchema);
  if ("response" in body) return body.response;
  if (body.data.import_ref) {
    const taken = await db.catalogItem.findUnique({ where: { importRef: body.data.import_ref }, select: { id: true } });
    if (taken && taken.id !== current.id) return importRefTaken(taken.id);
  }
  const prepared = await prepareCatalogItem(body.data, current);
  if ("response" in prepared) return prepared.response;

  try {
    const { item, changed } = await updateCatalogItemRecord(current, prepared.data, auth.principal.userId, "API");
    return catalogItemResponse(item, { meta: { changed } });
  } catch (err) {
    return catalogWriteConflict(err);
  }
}

/** Delete a catalog item (MANAGER+). Requests already made from it keep their answers and history. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, CATALOG_WHAT);
  if (refused) return refused;
  const { id } = await ctx.params;
  const item = await db.catalogItem.findUnique({ where: { id }, select: { name: true } });
  if (!item) return catalogItemNotFound();
  // deleteMany: a concurrent delete between the lookup and here is a 404, not a 500.
  const { count } = await db.catalogItem.deleteMany({ where: { id } });
  if (count === 0) return catalogItemNotFound();
  await writeAudit({ userId: auth.principal.userId, action: "DELETE", entity: "CatalogItem", entityId: id, summary: `Deleted catalog item "${item.name}" via API` });
  revalidatePath("/catalog");
  return ok({ id, deleted: true });
}
