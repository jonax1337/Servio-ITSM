import { db } from "@/lib/db";
import { ok, apiError, preflight } from "@/lib/api";
import { updateProblemDetails, updateProblemField, updateProblemText } from "@/lib/actions/problems";
import { formOf, problemEditSteps, problemPatchSchema, type EditStep } from "@/lib/api-itsm-input";
import { PROBLEM_INCLUDE, serializeProblem } from "../../_serializers";
import { agentGuard, asActor, readBody, recordId, refusal } from "../../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "read");
  if ("response" in auth) return auth.response;
  const id = recordId((await ctx.params).id);
  const problem = id ? await db.problem.findUnique({ where: { id }, include: PROBLEM_INCLUDE }) : null;
  if (!problem) return apiError(404, "Problem not found");
  return ok(serializeProblem(problem));
}

async function applyStep(id: number, step: EditStep, current: { title: string; description: string }): Promise<string | null> {
  let result: { ok: true } | { ok: false; error: string };
  switch (step.kind) {
    case "details":
      result = await updateProblemDetails(formOf({ id, title: step.title ?? current.title, description: step.description ?? current.description }));
      break;
    case "field":
      result = await updateProblemField(formOf({ id, field: step.field, value: step.value }));
      break;
    case "text":
      result = await updateProblemText(formOf({ id, field: step.field, value: step.value }));
      break;
    default:
      return "That change isn't valid for this problem.";
  }
  return result.ok ? null : result.error;
}

/**
 * Edit a problem through the console actions that own each field (field locks
 * per status, group membership, root cause/workaround the status depends on).
 * Status is changed with POST /problems/{id}/transitions. Applied in order;
 * on a refusal the earlier edits stay, see `details.applied`.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const id = recordId((await ctx.params).id);
  const current = id ? await db.problem.findUnique({ where: { id }, select: { title: true, description: true } }) : null;
  if (!id || !current) return apiError(404, "Problem not found");
  const body = await readBody(req, problemPatchSchema);
  if ("response" in body) return body.response;

  const applied: string[] = [];
  const failure = await asActor(auth.principal, async () => {
    for (const step of problemEditSteps(body.data)) {
      const error = await applyStep(id, step, current);
      if (error) return { error, fields: step.fields };
      applied.push(...step.fields);
    }
    return null;
  });

  const problem = await db.problem.findUniqueOrThrow({ where: { id }, include: PROBLEM_INCLUDE });
  if (failure) return refusal(failure.error, { field: failure.fields, applied, problem: serializeProblem(problem) });
  return ok(serializeProblem(problem));
}
