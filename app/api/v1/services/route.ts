import { db } from "@/lib/db";
import { guard, ok, apiError, preflight, principalIsAgent } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const auth = await guard(req, "cmdb:read");
  if ("response" in auth) return auth.response;
  // The service catalog is agent data. Non-agent tokens must not enumerate it (BOLA).
  if (!principalIsAgent(auth.principal)) return apiError(403, "Services are restricted to agent tokens.");

  const services = await db.service.findMany({
    orderBy: { name: "asc" },
    include: { sla: true, category: true },
  });

  return ok(
    services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      status: s.status,
      criticality: s.criticality,
      category: s.category?.name ?? null,
      sla: s.sla ? { name: s.sla.name, response_mins: s.sla.responseMins, resolve_mins: s.sla.resolveMins } : null,
    })),
  );
}
