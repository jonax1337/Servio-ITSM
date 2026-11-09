import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiError, ok } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { apiFieldNames, changedColumns } from "@/lib/api-record-diff";
import {
  assetSetDiff, contractData, contractDateProblem, serializeContract, type ContractPatch, type ContractRow,
} from "@/lib/api-contract-input";
import { importRefTaken, isUniqueOn } from "./_manage";

/** Shared plumbing of the /contracts endpoints. */

export const CONTRACT_WHAT = "contracts";

export const CONTRACT_INCLUDE = {
  vendor: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true, email: true } },
  assets: { select: { asset: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
} as const satisfies Prisma.ContractInclude;

type Current = ContractRow & { assets: { asset: { id: string; name: string } }[] };
type Data = ReturnType<typeof contractData>;

export function contractNotFound() {
  return apiError(404, "Contract not found");
}

/**
 * The Prisma data for a body on top of `current` (absent on create): 422 for an
 * unknown vendor, owner or asset, or an end date before the start date; 409 for
 * an import_ref another contract already carries.
 */
export async function prepareContract(
  b: Partial<ContractPatch>,
  current: Current | null,
): Promise<{ data: Data; assetIds: string[] | undefined } | { response: ReturnType<typeof apiError> }> {
  const data = contractData(b);
  const [vendor, owner, assets] = await Promise.all([
    data.vendorId ? db.vendor.findUnique({ where: { id: data.vendorId }, select: { id: true } }) : true,
    data.ownerId ? db.user.findUnique({ where: { id: data.ownerId }, select: { id: true } }) : true,
    b.asset_ids?.length ? db.asset.findMany({ where: { id: { in: b.asset_ids } }, select: { id: true } }) : [],
  ]);
  if (!vendor) return { response: apiError(422, "Validation failed", { vendor_id: ["Vendor not found."] }) };
  if (!owner) return { response: apiError(422, "Validation failed", { owner_id: ["Owner not found."] }) };
  const assetIds = b.asset_ids ? [...new Set(b.asset_ids)] : undefined;
  if (assetIds) {
    const found = new Set(assets.map((a) => a.id));
    const unknown = assetIds.filter((id) => !found.has(id));
    if (unknown.length) return { response: apiError(422, "Validation failed", { asset_ids: [`Unknown asset: ${unknown.join(", ")}`] }) };
  }
  const dates = contractDateProblem(current, data);
  if (dates) return { response: apiError(422, "Validation failed", dates) };
  if (data.importRef && data.importRef !== current?.importRef) {
    const taken = await db.contract.findUnique({ where: { importRef: data.importRef }, select: { id: true } });
    if (taken && taken.id !== current?.id) return { response: importRefTaken(taken.id) };
  }
  return { data, assetIds };
}

/** Audit + revalidate the assets a contract started or stopped covering. */
async function auditCoverage(actorId: string, contract: { id: string; name: string }, add: string[], remove: string[]) {
  if (!add.length && !remove.length) return;
  const names = new Map(
    (await db.asset.findMany({ where: { id: { in: [...add, ...remove] } }, select: { id: true, name: true } })).map((a) => [a.id, a.name]),
  );
  for (const [ids, contractText, assetText] of [
    [add, "Covered asset", "Covered by contract"],
    [remove, "No longer covers asset", "No longer covered by contract"],
  ] as const) {
    for (const assetId of ids) {
      await writeAudit({ userId: actorId, action: "UPDATE", entity: "Contract", entityId: contract.id, summary: `${contractText} "${names.get(assetId) ?? assetId}" via API` });
      await writeAudit({ userId: actorId, action: "UPDATE", entity: "Asset", entityId: assetId, summary: `${assetText} "${contract.name}" via API` });
      revalidatePath(`/assets/${assetId}`);
    }
  }
}

export async function createContractRecord(
  data: Data & { name: string },
  assetIds: string[] | undefined,
  actorId: string,
  via: string,
) {
  const contract = await db.contract.create({
    data: {
      ...(data as Prisma.ContractUncheckedCreateInput),
      ...(assetIds?.length && { assets: { create: assetIds.map((assetId) => ({ assetId })) } }),
    },
    include: CONTRACT_INCLUDE,
  });
  await writeAudit({ userId: actorId, action: "CREATE", entity: "Contract", entityId: contract.id, summary: `Created contract "${contract.name}" via ${via}` });
  await auditCoverage(actorId, contract, assetIds ?? [], []);
  revalidatePath("/contracts");
  return contract;
}

/** Write the columns that differ and bring the covered assets to `assetIds`; an unchanged body writes nothing. */
export async function updateContractRecord(current: Current, data: Data, assetIds: string[] | undefined, actorId: string, via: string) {
  const columns = changedColumns(current, data);
  const { add, remove } = assetIds ? assetSetDiff(current.assets.map((a) => a.asset.id), assetIds) : { add: [], remove: [] };
  const changed = [...apiFieldNames(columns), ...(add.length || remove.length ? ["asset_ids"] : [])];
  if (changed.length === 0) return { contract: current, changed };

  const patch = Object.fromEntries(columns.map((k) => [k, data[k as keyof Data]]));
  const contract = await db.$transaction(async (tx) => {
    if (remove.length) await tx.contractAsset.deleteMany({ where: { contractId: current.id, assetId: { in: remove } } });
    if (add.length) await tx.contractAsset.createMany({ data: add.map((assetId) => ({ contractId: current.id, assetId })) });
    return tx.contract.update({ where: { id: current.id }, data: patch, include: CONTRACT_INCLUDE });
  });
  if (columns.length) {
    await writeAudit({
      userId: actorId, action: "UPDATE", entity: "Contract", entityId: contract.id,
      summary: `Updated contract "${contract.name}" via ${via} (${apiFieldNames(columns).join(", ")})`, meta: { changed },
    });
  }
  await auditCoverage(actorId, contract, add, remove);
  revalidatePath("/contracts");
  revalidatePath(`/contracts/${contract.id}`);
  return { contract, changed };
}

export function contractResponse(c: ContractRow, init?: { status?: number; meta?: unknown }) {
  return ok(serializeContract(c), init);
}

/** 409 for an import_ref lost to a concurrent writer; otherwise rethrows. */
export function contractWriteConflict(err: unknown) {
  if (isUniqueOn(err, "importRef")) return importRefTaken();
  throw err;
}
