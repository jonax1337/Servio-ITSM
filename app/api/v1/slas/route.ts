import { db } from "@/lib/db";
import { ok, preflight } from "@/lib/api";
import { slaCreateSchema, serializeSla } from "@/lib/api-sla-input";
import { agentGuard, readBody } from "../_itsm";
import { managerOnly } from "../_manage";
import { SLA_SELECT, SLA_WHAT, createSlaRecord, prepareSla, slaResponse, slaWriteConflict } from "../_slas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** SLAs, fastest resolution first. Filters: `active=true|false`, `priority`, `import_ref`. Agent tokens only. */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "sla:read");
  if ("response" in auth) return auth.response;
  const p = new URL(req.url).searchParams;
  const active = p.get("active");
  const rows = await db.sLA.findMany({
    where: {
      ...(active === "true" && { isActive: true }),
      ...(active === "false" && { isActive: false }),
      ...(p.get("priority") && { priority: p.get("priority")! }),
      ...(p.get("import_ref") && { importRef: p.get("import_ref")! }),
    },
    orderBy: [{ isActive: "desc" }, { resolveMins: "asc" }, { name: "asc" }],
    select: SLA_SELECT,
  });
  return ok(rows.map(serializeSla));
}

/**
 * Create an SLA (MANAGER+, like the console). Names are unique: a duplicate name or `import_ref` is a 409
 * with the existing SLA's `id`. The working-hours calendar is set with `business_calendar_id` or
 * `business_calendar_ref`.
 */
export async function POST(req: Request) {
  const auth = await agentGuard(req, "sla:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, SLA_WHAT);
  if (refused) return refused;
  const body = await readBody(req, slaCreateSchema);
  if ("response" in body) return body.response;
  const prepared = await prepareSla(body.data, null);
  if ("response" in prepared) return prepared.response;
  try {
    const id = await createSlaRecord(
      { ...prepared.data, name: body.data.name, responseMins: body.data.response_mins, resolveMins: body.data.resolve_mins },
      auth.principal.userId,
      "API",
    );
    return slaResponse(id, { status: 201 });
  } catch (err) {
    return slaWriteConflict(err);
  }
}
