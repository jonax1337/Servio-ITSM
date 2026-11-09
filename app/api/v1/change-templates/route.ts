import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, pageMeta, paginate, preflight } from "@/lib/api";
import { changeTemplateCreateSchema, serializeChangeTemplate } from "@/lib/api-change-template-input";
import { agentGuard, readBody } from "../_itsm";
import { managerOnly } from "../_manage";
import { TEMPLATE_WHAT, createTemplateRecord, prepareChangeTemplate, templateResponse, templateWriteConflict } from "../_change-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Change templates (standard change models). Filters: `q` (name), `type`, `service_id`, `active` (true | false, default both). */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "catalog:read");
  if ("response" in auth) return auth.response;
  const p = new URL(req.url).searchParams;
  const { page, perPage, skip, take } = paginate(p);
  const where: Prisma.ChangeTemplateWhereInput = {};
  if (p.get("q")) where.name = { contains: p.get("q")! };
  if (p.get("type")) where.type = p.get("type")!;
  if (p.get("service_id")) where.serviceId = p.get("service_id")!;
  const active = p.get("active");
  if (active === "true" || active === "false") where.isActive = active === "true";
  const [total, rows] = await Promise.all([
    db.changeTemplate.count({ where }),
    db.changeTemplate.findMany({ where, orderBy: { name: "asc" }, skip, take }),
  ]);
  return ok(rows.map(serializeChangeTemplate), { meta: pageMeta(page, perPage, total) });
}

/**
 * Create a change template (MANAGER+). A STANDARD template (the default) needs an
 * implementation and a rollback plan, because its changes skip the CAB. A name or
 * `import_ref` already in use is a 409 with the existing `id`.
 */
export async function POST(req: Request) {
  const auth = await agentGuard(req, "catalog:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, TEMPLATE_WHAT);
  if (refused) return refused;
  const body = await readBody(req, changeTemplateCreateSchema);
  if ("response" in body) return body.response;
  const prepared = await prepareChangeTemplate(body.data, null, auth.principal.role);
  if ("response" in prepared) return prepared.response;

  try {
    const template = await createTemplateRecord({ ...prepared.data, name: body.data.name, title: body.data.title }, auth.principal.userId, "API");
    return templateResponse(template, { status: 201 });
  } catch (err) {
    return templateWriteConflict(err);
  }
}
