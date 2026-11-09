import { db } from "@/lib/db";
import { apiError, preflight, type ApiPrincipal } from "@/lib/api";
import { CATALOG_FIELD_RENAMES, catalogItemUpsertSchema, type CatalogItemUpsert } from "@/lib/api-catalog-input";
import { apiFieldNames } from "@/lib/api-record-diff";
import { agentGuard, readBody } from "../../../_itsm";
import { invalidRef, isUniqueOn, managerOnly, refOf } from "../../../_manage";
import {
  CATALOG_WHAT, catalogItemNotFound, catalogItemResponse, createCatalogItemRecord, prepareCatalogItem, updateCatalogItemRecord,
} from "../../../_catalog-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** The catalog item with this origin reference (e.g. `catalog:new-laptop`), or 404. */
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "read");
  if ("response" in auth) return auth.response;
  const ref = await refOf(ctx);
  const item = ref ? await db.catalogItem.findUnique({ where: { importRef: ref } }) : null;
  if (!item) return catalogItemNotFound();
  return catalogItemResponse(item);
}

/**
 * Upsert by origin reference, for keeping a catalog in step with a source
 * (MANAGER+). Creates the item (201; `name` required) when the reference is new,
 * otherwise writes only the fields sent (200). Re-sending unchanged fields writes
 * nothing and no audit row; `meta.changed` lists what changed.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, CATALOG_WHAT);
  if (refused) return refused;
  const ref = await refOf(ctx);
  if (!ref) return invalidRef();
  const body = await readBody(req, catalogItemUpsertSchema);
  if ("response" in body) return body.response;

  try {
    return await upsert(auth.principal, ref, body.data);
  } catch (err) {
    // Two runs creating the same ref at once: the loser retries as an update.
    if (isUniqueOn(err, "importRef")) return upsert(auth.principal, ref, body.data);
    throw err;
  }
}

async function upsert(principal: ApiPrincipal, ref: string, b: CatalogItemUpsert) {
  const current = await db.catalogItem.findUnique({ where: { importRef: ref } });
  if (!current && !b.name) return apiError(422, "Validation failed", { name: ["Required to create a new catalog item"] });
  const prepared = await prepareCatalogItem(b, current);
  if ("response" in prepared) return prepared.response;
  const via = `API (${ref})`;
  if (!current) {
    const item = await createCatalogItemRecord({ ...prepared.data, name: b.name!, importRef: ref }, principal.userId, via);
    return catalogItemResponse(item, { status: 201, meta: { created: true, changed: apiFieldNames(Object.keys(prepared.data), CATALOG_FIELD_RENAMES) } });
  }
  const { item, changed } = await updateCatalogItemRecord(current, prepared.data, principal.userId, via);
  return catalogItemResponse(item, { meta: { created: false, changed } });
}
