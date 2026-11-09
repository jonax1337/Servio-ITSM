import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, preflight, paginate, pageMeta } from "@/lib/api";
import { createLicense } from "@/lib/actions/contracts";
import { formOf } from "@/lib/api-itsm-input";
import { licenseCreateSchema, licenseForm } from "@/lib/api-asset-input";
import { LICENSE_INCLUDE, serializeLicense } from "../_serializers";
import { agentGuard, asActor, readBody, refusal } from "../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Software licenses with their seat assignments. Filters: `vendor_id`, `q` (name), `asset_id` / `user_id` (licenses assigned to it). */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "cmdb:read");
  if ("response" in auth) return auth.response;
  const p = new URL(req.url).searchParams;
  const { page, perPage, skip, take } = paginate(p);
  const where: Prisma.SoftwareLicenseWhereInput = {};
  if (p.get("vendor_id")) where.vendorId = p.get("vendor_id")!;
  if (p.get("q")) where.name = { contains: p.get("q")! };
  if (p.get("asset_id")) where.assignments = { some: { assetId: p.get("asset_id")! } };
  if (p.get("user_id")) where.assignments = { some: { userId: p.get("user_id")! } };
  const [total, rows] = await Promise.all([
    db.softwareLicense.count({ where }),
    db.softwareLicense.findMany({ where, include: LICENSE_INCLUDE, orderBy: { name: "asc" }, skip, take }),
  ]);
  return ok(rows.map(serializeLicense), { meta: pageMeta(page, perPage, total) });
}

/** Create a license through the console's createLicense (MANAGER or above; vendor, contract and owner must exist). */
export async function POST(req: Request) {
  const auth = await agentGuard(req, "cmdb:write");
  if ("response" in auth) return auth.response;
  const body = await readBody(req, licenseCreateSchema);
  if ("response" in body) return body.response;
  const result = await asActor(auth.principal, () => createLicense(formOf(licenseForm(null, body.data))));
  if (!result.ok || !result.id) return refusal(result.ok ? "The license could not be created." : result.error ?? "The request was refused.");
  const license = await db.softwareLicense.findUniqueOrThrow({ where: { id: result.id }, include: LICENSE_INCLUDE });
  return ok(serializeLicense(license), { status: 201 });
}
