import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiError, ok, pageMeta, paginate, preflight } from "@/lib/api";
import { contractCreateSchema, serializeContract } from "@/lib/api-contract-input";
import { agentGuard, readBody } from "../_itsm";
import { managerOnly } from "../_manage";
import { CONTRACT_INCLUDE, CONTRACT_WHAT, contractResponse, contractWriteConflict, createContractRecord, prepareContract } from "../_contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Vendor contracts with the assets they cover. Filters: `q` (name or number),
 * `vendor_id`, `owner_id`, `status`, `type`, `asset_id` (contracts covering it),
 * `ends_before` (YYYY-MM-DD: an end date before that day). Ordered by end date.
 */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "cmdb:read");
  if ("response" in auth) return auth.response;
  const p = new URL(req.url).searchParams;
  const { page, perPage, skip, take } = paginate(p);
  const where: Prisma.ContractWhereInput = {};
  const q = p.get("q");
  if (q) where.OR = [{ name: { contains: q } }, { number: { contains: q } }];
  if (p.get("vendor_id")) where.vendorId = p.get("vendor_id")!;
  if (p.get("owner_id")) where.ownerId = p.get("owner_id")!;
  if (p.get("status")) where.status = p.get("status")!;
  if (p.get("type")) where.type = p.get("type")!;
  if (p.get("asset_id")) where.assets = { some: { assetId: p.get("asset_id")! } };
  const endsBefore = p.get("ends_before");
  if (endsBefore) {
    if (!DAY_RE.test(endsBefore) || Number.isNaN(Date.parse(endsBefore))) {
      return apiError(422, "Validation failed", { ends_before: ["Use a day like 2026-12-31"] });
    }
    where.endDate = { lt: new Date(`${endsBefore}T00:00:00.000Z`) };
  }
  const [total, rows] = await Promise.all([
    db.contract.count({ where }),
    db.contract.findMany({ where, include: CONTRACT_INCLUDE, orderBy: [{ endDate: "asc" }, { name: "asc" }], skip, take }),
  ]);
  const now = new Date();
  return ok(rows.map((c) => serializeContract(c, now)), { meta: pageMeta(page, perPage, total) });
}

/** Create a contract (MANAGER+). Vendor, owner and assets must exist; an `import_ref` in use is a 409 with the existing `id`. */
export async function POST(req: Request) {
  const auth = await agentGuard(req, "cmdb:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, CONTRACT_WHAT);
  if (refused) return refused;
  const body = await readBody(req, contractCreateSchema);
  if ("response" in body) return body.response;
  const prepared = await prepareContract(body.data, null);
  if ("response" in prepared) return prepared.response;

  try {
    const { data, assetIds } = prepared;
    const contract = await createContractRecord(
      { ...data, name: body.data.name, startDate: data.startDate! },
      assetIds,
      auth.principal.userId,
      "API",
    );
    return contractResponse(contract, { status: 201 });
  } catch (err) {
    return contractWriteConflict(err);
  }
}
