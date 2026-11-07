import { db } from "@/lib/db";
import { ok, apiError, preflight } from "@/lib/api";
import { updateProblemField } from "@/lib/actions/problems";
import { formOf, problemTransitionSchema } from "@/lib/api-itsm-input";
import { PROBLEM_INCLUDE, serializeProblem } from "../../../_serializers";
import { agentGuard, asActor, readBody, recordId, refusal } from "../../../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * Move a problem along its lifecycle (configured transition map + role gates).
 * KNOWN_ERROR and later need the root cause / workaround the console asks for:
 * set them with PATCH first. 409 with the console's reason when refused.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const id = recordId((await ctx.params).id);
  const exists = id ? await db.problem.findUnique({ where: { id }, select: { id: true } }) : null;
  if (!id || !exists) return apiError(404, "Problem not found");
  const body = await readBody(req, problemTransitionSchema);
  if ("response" in body) return body.response;

  const result = await asActor(auth.principal, () => updateProblemField(formOf({ id, field: "status", value: body.data.to })));
  if (!result.ok) return refusal(result.error);
  const problem = await db.problem.findUniqueOrThrow({ where: { id }, include: PROBLEM_INCLUDE });
  return ok(serializeProblem(problem));
}
