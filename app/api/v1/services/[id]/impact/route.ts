import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { serviceImpact } from "@/lib/service-graph";
import { agentGuard } from "../../../_itsm";
import { serializeImpact } from "../../../_services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** The services that go down with this one: everything depending on it, transitively, nearest first (`depth` 1 = direct dependants). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "cmdb:read");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  if (!(await db.service.findUnique({ where: { id }, select: { id: true } }))) return apiError(404, "Service not found");
  return ok((await serviceImpact(id)).map(serializeImpact));
}
