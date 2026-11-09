import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { contractPatchSchema } from "@/lib/api-contract-input";
import { agentGuard, readBody } from "../../_itsm";
import { managerOnly } from "../../_manage";
import {
  CONTRACT_INCLUDE, CONTRACT_WHAT, contractNotFound, contractResponse, contractWriteConflict, prepareContract, updateContractRecord,
} from "../../_contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "read");
  if ("response" in auth) return auth.response;
  const contract = await db.contract.findUnique({ where: { id: (await ctx.params).id }, include: CONTRACT_INCLUDE });
  if (!contract) return contractNotFound();
  return contractResponse(contract);
}

/**
 * Edit a contract (MANAGER+). Fields left out keep their value, `null` clears a
 * nullable one, `asset_ids` replaces the covered assets. `meta.changed` lists what changed.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, CONTRACT_WHAT);
  if (refused) return refused;
  const current = await db.contract.findUnique({ where: { id: (await ctx.params).id }, include: CONTRACT_INCLUDE });
  if (!current) return contractNotFound();
  const body = await readBody(req, contractPatchSchema);
  if ("response" in body) return body.response;
  const prepared = await prepareContract(body.data, current);
  if ("response" in prepared) return prepared.response;

  try {
    const { contract, changed } = await updateContractRecord(current, prepared.data, prepared.assetIds, auth.principal.userId, "API");
    return contractResponse(contract, { meta: { changed } });
  } catch (err) {
    return contractWriteConflict(err);
  }
}

/** Delete a contract (MANAGER+). Licenses under it stay, without a contract; covered assets lose the link. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, CONTRACT_WHAT);
  if (refused) return refused;
  const { id } = await ctx.params;
  const contract = await db.contract.findUnique({ where: { id }, select: { name: true, assets: { select: { assetId: true } } } });
  if (!contract) return contractNotFound();
  await db.contract.delete({ where: { id } });
  await writeAudit({ userId: auth.principal.userId, action: "DELETE", entity: "Contract", entityId: id, summary: `Deleted contract "${contract.name}" via API` });
  revalidatePath("/contracts");
  for (const { assetId } of contract.assets) revalidatePath(`/assets/${assetId}`);
  return ok({ id, deleted: true });
}
