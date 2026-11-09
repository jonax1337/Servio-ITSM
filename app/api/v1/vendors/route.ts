import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, preflight, paginate, pageMeta } from "@/lib/api";
import { vendorCreateSchema } from "@/lib/api-asset-input";
import { serializeVendor } from "../_serializers";
import { agentGuard, readBody } from "../_itsm";
import { managerOnly } from "../_manage";
import { VENDOR_WHAT, createVendorRecord, prepareVendor, vendorResponse, vendorWriteConflict } from "../_vendors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Vendors (suppliers of contracts and licenses). Filters: `name` (exact), `q`, `active` (true | false | all, default all). */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "cmdb:read");
  if ("response" in auth) return auth.response;
  const p = new URL(req.url).searchParams;
  const { page, perPage, skip, take } = paginate(p);
  const where: Prisma.VendorWhereInput = {};
  if (p.get("name")) where.name = p.get("name")!;
  if (p.get("q")) where.name = { contains: p.get("q")! };
  const active = p.get("active");
  if (active === "true" || active === "false") where.isActive = active === "true";
  const [total, rows] = await Promise.all([
    db.vendor.count({ where }),
    db.vendor.findMany({ where, orderBy: { name: "asc" }, skip, take }),
  ]);
  return ok(rows.map(serializeVendor), { meta: pageMeta(page, perPage, total) });
}

/** Create a vendor (MANAGER or above). Names are unique: a duplicate name or `import_ref` is a 409 with the existing `id`. */
export async function POST(req: Request) {
  const auth = await agentGuard(req, "cmdb:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, VENDOR_WHAT);
  if (refused) return refused;
  const body = await readBody(req, vendorCreateSchema);
  if ("response" in body) return body.response;
  const prepared = await prepareVendor(body.data, null);
  if ("response" in prepared) return prepared.response;
  try {
    const vendor = await createVendorRecord({ ...prepared.data, name: body.data.name }, auth.principal.userId, "API");
    return vendorResponse(vendor, { status: 201 });
  } catch (err) {
    return vendorWriteConflict(err);
  }
}
