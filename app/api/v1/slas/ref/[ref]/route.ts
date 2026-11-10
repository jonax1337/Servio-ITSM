import { db } from "@/lib/db";
import { apiError, preflight, type ApiPrincipal } from "@/lib/api";
import { slaUpsertSchema, type SlaUpsert } from "@/lib/api-sla-input";
import { agentGuard, readBody } from "../../../_itsm";
import { invalidRef, isUniqueOn, managerOnly, refOf } from "../../../_manage";
import { SLA_SELECT, SLA_WHAT, createSlaRecord, prepareSla, slaNotFound, slaResponse, slaWriteConflict, updateSlaRecord } from "../../../_slas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** The SLA with this origin reference (e.g. `sla:gold`), or 404. */
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "sla:read");
  if ("response" in auth) return auth.response;
  const ref = await refOf(ctx);
  const row = ref ? await db.sLA.findUnique({ where: { importRef: ref }, select: { id: true } }) : null;
  if (!row) return slaNotFound();
  return slaResponse(row.id);
}

/**
 * Upsert by origin reference (MANAGER+), for keeping SLAs in step with a source. Creates the SLA (201;
 * `name`, `response_mins` and `resolve_mins` required) when the reference is new, otherwise writes only
 * the fields sent (200). Re-sending the same facts writes nothing and no audit row; `meta.changed` lists
 * what changed. A name another SLA already has is a 409 with that SLA's `id` (adopt it by setting its
 * `import_ref` with PATCH).
 */
export async function PUT(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "sla:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, SLA_WHAT);
  if (refused) return refused;
  const ref = await refOf(ctx);
  if (!ref) return invalidRef();
  const body = await readBody(req, slaUpsertSchema);
  if ("response" in body) return body.response;

  try {
    return await upsert(auth.principal, ref, body.data);
  } catch (err) {
    // Two runs creating the same ref at once: the loser retries as an update.
    if (isUniqueOn(err, "importRef")) return upsert(auth.principal, ref, body.data).catch(slaWriteConflict);
    return slaWriteConflict(err);
  }
}

async function upsert(principal: ApiPrincipal, ref: string, b: SlaUpsert) {
  const current = await db.sLA.findUnique({ where: { importRef: ref }, select: SLA_SELECT });
  if (!current) {
    const missing = Object.fromEntries(
      (["name", "response_mins", "resolve_mins"] as const).filter((k) => b[k] === undefined).map((k) => [k, ["Required to create a new SLA"]]),
    );
    if (Object.keys(missing).length) return apiError(422, "Validation failed", missing);
  }
  const prepared = await prepareSla(b, current);
  if ("response" in prepared) return prepared.response;
  const via = `API (${ref})`;
  if (!current) {
    const id = await createSlaRecord(
      { ...prepared.data, name: b.name!, responseMins: b.response_mins!, resolveMins: b.resolve_mins!, importRef: ref },
      principal.userId,
      via,
    );
    return slaResponse(id, { status: 201, meta: { created: true, changed: Object.keys(b) } });
  }
  const { id, changed } = await updateSlaRecord(current, prepared.data, principal.userId, via);
  return slaResponse(id, { meta: { created: false, changed } });
}
