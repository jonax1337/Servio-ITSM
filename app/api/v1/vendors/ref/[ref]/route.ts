import { db } from "@/lib/db";
import { apiError, preflight, type ApiPrincipal } from "@/lib/api";
import { VENDOR_FIELD_RENAMES, vendorUpsertSchema } from "@/lib/api-asset-input";
import { apiFieldNames } from "@/lib/api-record-diff";
import type { z } from "zod";
import { agentGuard, readBody } from "../../../_itsm";
import { invalidRef, isUniqueOn, managerOnly, refOf } from "../../../_manage";
import { VENDOR_WHAT, createVendorRecord, prepareVendor, updateVendorRecord, vendorNotFound, vendorResponse, vendorWriteConflict } from "../../../_vendors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** The vendor with this origin reference (e.g. `erp:supplier:118`), or 404. */
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "read");
  if ("response" in auth) return auth.response;
  const ref = await refOf(ctx);
  const vendor = ref ? await db.vendor.findUnique({ where: { importRef: ref } }) : null;
  if (!vendor) return vendorNotFound();
  return vendorResponse(vendor);
}

/**
 * Upsert by origin reference (MANAGER+). Creates the vendor (201; `name`
 * required) when the reference is new, otherwise writes only the fields sent
 * (200). Unchanged fields write nothing; `meta.changed` lists what changed. A
 * name another vendor already has is a 409 with that vendor's `id` (adopt it by
 * setting its `import_ref` with PATCH).
 */
export async function PUT(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, VENDOR_WHAT);
  if (refused) return refused;
  const ref = await refOf(ctx);
  if (!ref) return invalidRef();
  const body = await readBody(req, vendorUpsertSchema);
  if ("response" in body) return body.response;

  try {
    return await upsert(auth.principal, ref, body.data);
  } catch (err) {
    // Two runs creating the same ref at once: the loser retries as an update.
    if (isUniqueOn(err, "importRef")) return upsert(auth.principal, ref, body.data).catch(vendorWriteConflict);
    return vendorWriteConflict(err);
  }
}

async function upsert(principal: ApiPrincipal, ref: string, b: z.infer<typeof vendorUpsertSchema>) {
  const current = await db.vendor.findUnique({ where: { importRef: ref } });
  if (!current && !b.name) return apiError(422, "Validation failed", { name: ["Required to create a new vendor"] });
  const prepared = await prepareVendor(b, current);
  if ("response" in prepared) return prepared.response;
  const via = `API (${ref})`;
  if (!current) {
    const vendor = await createVendorRecord({ ...prepared.data, name: b.name!, importRef: ref }, principal.userId, via);
    return vendorResponse(vendor, { status: 201, meta: { created: true, changed: apiFieldNames(Object.keys(prepared.data), VENDOR_FIELD_RENAMES) } });
  }
  const { vendor, changed } = await updateVendorRecord(current, prepared.data, principal.userId, via);
  return vendorResponse(vendor, { meta: { created: false, changed } });
}
