import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, preflight, paginate, pageMeta } from "@/lib/api";
import { createVendor } from "@/lib/actions/contracts";
import { formOf } from "@/lib/api-itsm-input";
import { vendorCreateSchema } from "@/lib/api-asset-input";
import { serializeVendor } from "../_serializers";
import { agentGuard, asActor, readBody, refusal } from "../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Vendors (suppliers of contracts and licenses). Filters: `name` (exact), `q`, `active` (true | false | all, default all). */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "read");
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

/** Create a vendor through the console's createVendor (MANAGER or above; names are unique, a duplicate is a 409). */
export async function POST(req: Request) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const body = await readBody(req, vendorCreateSchema);
  if ("response" in body) return body.response;
  const result = await asActor(auth.principal, () => createVendor(formOf(body.data)));
  if (!result.ok || !result.id) return refusal(result.ok ? "The vendor could not be created." : result.error ?? "The request was refused.");
  return ok(serializeVendor(await db.vendor.findUniqueOrThrow({ where: { id: result.id } })), { status: 201 });
}
