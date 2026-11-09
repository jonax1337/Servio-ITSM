import { db } from "@/lib/db";
import { apiError, preflight, type ApiPrincipal } from "@/lib/api";
import { contractUpsertSchema, type ContractUpsert } from "@/lib/api-contract-input";
import { apiFieldNames } from "@/lib/api-record-diff";
import { agentGuard, readBody } from "../../../_itsm";
import { invalidRef, isUniqueOn, managerOnly, refOf } from "../../../_manage";
import {
  CONTRACT_INCLUDE, CONTRACT_WHAT, contractNotFound, contractResponse, contractWriteConflict, createContractRecord, prepareContract,
  updateContractRecord,
} from "../../../_contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** The contract with this origin reference (e.g. `erp:contract:4711`), or 404. */
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "cmdb:read");
  if ("response" in auth) return auth.response;
  const ref = await refOf(ctx);
  const contract = ref ? await db.contract.findUnique({ where: { importRef: ref }, include: CONTRACT_INCLUDE }) : null;
  if (!contract) return contractNotFound();
  return contractResponse(contract);
}

/**
 * Upsert by origin reference (MANAGER+), for keeping contracts in step with a
 * procurement or ERP source. Creates the contract (201; `name` required) when
 * the reference is new, otherwise writes only the fields sent (200). Unchanged
 * fields write nothing and no audit row; `meta.changed` lists what changed.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "cmdb:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, CONTRACT_WHAT);
  if (refused) return refused;
  const ref = await refOf(ctx);
  if (!ref) return invalidRef();
  const body = await readBody(req, contractUpsertSchema);
  if ("response" in body) return body.response;

  try {
    return await upsert(auth.principal, ref, body.data);
  } catch (err) {
    // Two runs creating the same ref at once: the loser retries as an update.
    if (isUniqueOn(err, "importRef")) return upsert(auth.principal, ref, body.data).catch(contractWriteConflict);
    throw err;
  }
}

async function upsert(principal: ApiPrincipal, ref: string, b: ContractUpsert) {
  const current = await db.contract.findUnique({ where: { importRef: ref }, include: CONTRACT_INCLUDE });
  if (!current && !b.name) {
    return apiError(422, "Validation failed", { name: ["Required to create a new contract"] });
  }
  const prepared = await prepareContract(b, current);
  if ("response" in prepared) return prepared.response;
  const { data, assetIds } = prepared;
  const via = `API (${ref})`;
  if (!current) {
    const contract = await createContractRecord({ ...data, name: b.name!, importRef: ref }, assetIds, principal.userId, via);
    const changed = [...apiFieldNames(Object.keys(data)), ...(assetIds ? ["asset_ids"] : [])];
    return contractResponse(contract, { status: 201, meta: { created: true, changed } });
  }
  const { contract, changed } = await updateContractRecord(current, data, assetIds, principal.userId, via);
  return contractResponse(contract, { meta: { created: false, changed } });
}
