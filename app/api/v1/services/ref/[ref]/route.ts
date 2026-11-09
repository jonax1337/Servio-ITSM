import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { serviceUpsertSchema, type ServicePatch } from "@/lib/api-service-input";
import { EXTERNAL_REF_HINT, parseExternalRef } from "@/lib/ticket-external-ref";
import type { ApiPrincipal } from "@/lib/api";
import { agentGuard, readBody } from "../../../_itsm";
import { managerRefusal, saveService, serviceDetail } from "../../../_services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** The service with this origin reference (e.g. `catalog:mail`), or 404. */
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "cmdb:read");
  if ("response" in auth) return auth.response;
  const ref = parseExternalRef((await ctx.params).ref);
  const row = ref ? await db.service.findUnique({ where: { importRef: ref }, select: { id: true } }) : null;
  const detail = row ? await serviceDetail(row.id) : null;
  if (!detail) return apiError(404, "Service not found");
  return ok(detail);
}

/**
 * Upsert by origin reference (MANAGER+), for keeping the service map in step
 * with a source. Creates the service (201; `name` required) when the reference
 * is new, otherwise writes only the fields sent (200). Re-sending the same
 * facts writes nothing and no audit row; `meta.changed` lists what changed.
 * `depends_on` entries can name other services by `service_ref`, so a whole
 * map can be pushed in dependency order without knowing ids.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "cmdb:write");
  if ("response" in auth) return auth.response;
  const refused = managerRefusal(auth.principal);
  if (refused) return refused;
  const ref = parseExternalRef((await ctx.params).ref);
  if (!ref) return apiError(422, "Validation failed", { ref: [EXTERNAL_REF_HINT] });
  const body = await readBody(req, serviceUpsertSchema);
  if ("response" in body) return body.response;

  const res = await upsert(auth.principal, ref, body.data);
  if (res.status !== 409) return res;
  // Two runs creating the same ref at once: the loser's insert is refused (any unique clash
  // reports 409). If the ref exists now, retry once as an update; otherwise the 409 is genuine.
  return (await db.service.findUnique({ where: { importRef: ref }, select: { id: true } })) ? upsert(auth.principal, ref, body.data) : res;
}

async function upsert(principal: ApiPrincipal, ref: string, body: ServicePatch) {
  const existing = await db.service.findUnique({ where: { importRef: ref }, select: { id: true } });
  if (existing) return saveService(principal, body, { id: existing.id, via: `via API (${ref})` });
  if (!body.name) return apiError(422, "Validation failed", { name: ["Required to create a new service"] });
  return saveService(principal, body, { importRef: ref, via: `via API (${ref})` });
}
