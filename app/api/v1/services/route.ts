import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, preflight } from "@/lib/api";
import { serviceCreateSchema } from "@/lib/api-service-input";
import { agentGuard, readBody } from "../_itsm";
import { SERVICE_LIST_SELECT, managerRefusal, saveService, serializeService } from "../_services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * The service portfolio (not paginated). The catalog is agent data: non-agent
 * tokens must not enumerate it (BOLA). Filters: `status`, `criticality`, `code`,
 * `import_ref`, `q` (name or code).
 */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "cmdb:read");
  if ("response" in auth) return auth.response;
  const sp = new URL(req.url).searchParams;
  const where: Prisma.ServiceWhereInput = {};
  const status = sp.get("status");
  const criticality = sp.get("criticality");
  const code = sp.get("code");
  const importRef = sp.get("import_ref");
  if (status) where.status = status;
  if (criticality) where.criticality = criticality;
  if (code) where.code = code;
  if (importRef) where.importRef = importRef;
  const q = sp.get("q")?.trim();
  if (q) where.OR = [{ name: { contains: q } }, { code: { contains: q } }];

  const services = await db.service.findMany({ where, orderBy: { name: "asc" }, select: SERVICE_LIST_SELECT });
  return ok(services.map(serializeService));
}

/** Create a service (MANAGER+), with its supporting CIs and dependencies. */
export async function POST(req: Request) {
  const auth = await agentGuard(req, "cmdb:write");
  if ("response" in auth) return auth.response;
  const refused = managerRefusal(auth.principal);
  if (refused) return refused;
  const body = await readBody(req, serviceCreateSchema);
  if ("response" in body) return body.response;
  const { import_ref: importRef, ...fields } = body.data;
  return saveService(auth.principal, fields, { importRef, via: importRef ? `via API (${importRef})` : "via API" });
}
