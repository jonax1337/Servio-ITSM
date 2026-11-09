import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { vendorPatchSchema } from "@/lib/api-asset-input";
import { agentGuard, readBody } from "../../_itsm";
import { managerOnly } from "../../_manage";
import { VENDOR_WHAT, prepareVendor, updateVendorRecord, vendorNotFound, vendorResponse, vendorWriteConflict } from "../../_vendors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "cmdb:read");
  if ("response" in auth) return auth.response;
  const vendor = await db.vendor.findUnique({ where: { id: (await ctx.params).id } });
  if (!vendor) return vendorNotFound();
  return vendorResponse(vendor);
}

/** Edit a vendor (MANAGER or above). Fields left out keep their value; `null` clears one; `meta.changed` lists what changed. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "cmdb:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, VENDOR_WHAT);
  if (refused) return refused;
  const current = await db.vendor.findUnique({ where: { id: (await ctx.params).id } });
  if (!current) return vendorNotFound();
  const body = await readBody(req, vendorPatchSchema);
  if ("response" in body) return body.response;
  const prepared = await prepareVendor(body.data, current);
  if ("response" in prepared) return prepared.response;
  try {
    const { vendor, changed } = await updateVendorRecord(current, prepared.data, auth.principal.userId, "API");
    return vendorResponse(vendor, { meta: { changed } });
  } catch (err) {
    return vendorWriteConflict(err);
  }
}

/** Delete a vendor (MANAGER or above). Its contracts and licenses stay, without a vendor. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, VENDOR_WHAT);
  if (refused) return refused;
  const { id } = await ctx.params;
  const vendor = await db.vendor.findUnique({ where: { id }, select: { name: true } });
  if (!vendor) return vendorNotFound();
  // deleteMany: a concurrent delete between the lookup and here is a 404, not a 500.
  const { count } = await db.vendor.deleteMany({ where: { id } });
  if (count === 0) return vendorNotFound();
  await writeAudit({ userId: auth.principal.userId, action: "DELETE", entity: "Vendor", entityId: id, summary: `Deleted vendor "${vendor.name}" via API` });
  revalidatePath("/contracts");
  return ok({ id, deleted: true });
}
