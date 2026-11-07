import { db } from "@/lib/db";
import { ok, apiError, preflight } from "@/lib/api";
import {
  setChangeProblem,
  updateChangeDetails,
  updateChangeField,
  updateChangeText,
  updateChangeWindow,
} from "@/lib/actions/changes";
import { changeEditSteps, changePatchSchema, formOf, type EditStep } from "@/lib/api-itsm-input";
import { CHANGE_INCLUDE, serializeChange } from "../../_serializers";
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
  const change = id ? await db.change.findUnique({ where: { id }, include: CHANGE_INCLUDE }) : null;
  if (!change) return apiError(404, "Change not found");
  return ok(serializeChange(change));
}

type Current = { title: string; description: string; plannedStart: Date | null; plannedEnd: Date | null };

/** One step through the console action that owns that edit; returns the refusal message, or null. */
async function applyStep(id: number, step: EditStep, current: Current): Promise<string | null> {
  let result: { ok: true } | { ok: false; error: string };
  switch (step.kind) {
    case "details":
      result = await updateChangeDetails(formOf({ id, title: step.title ?? current.title, description: step.description ?? current.description }));
      break;
    case "field":
      result = await updateChangeField(formOf({ id, field: step.field, value: step.value }));
      break;
    case "text":
      result = await updateChangeText(formOf({ id, field: step.field, value: step.value }));
      break;
    case "window":
      // The action sets both ends at once; a side the request leaves out keeps its current value.
      result = await updateChangeWindow(
        formOf({
          id,
          plannedStart: step.plannedStart !== undefined ? step.plannedStart : current.plannedStart?.toISOString() ?? null,
          plannedEnd: step.plannedEnd !== undefined ? step.plannedEnd : current.plannedEnd?.toISOString() ?? null,
          reason: step.reason,
          justification: step.justification,
        }),
      );
      break;
    case "problem":
      result = await setChangeProblem(id, step.problemId);
      break;
  }
  return result.ok ? null : result.error;
}

/**
 * Edit a change. Each field goes through the console action that owns it, with
 * the same rules (locks after CLOSED/CANCELLED, group membership, standard-
 * template demotion, reschedule reason, freeze windows). Status is NOT editable
 * here — use POST /changes/{id}/transitions.
 *
 * The edits are applied in order (details, fields, plans, window, problem link).
 * If one is refused, the earlier ones stay applied: the error names the field
 * and lists `applied`, and the change is returned as it now is in `details.change`.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const id = recordId((await ctx.params).id);
  const current = id
    ? await db.change.findUnique({ where: { id }, select: { title: true, description: true, plannedStart: true, plannedEnd: true } })
    : null;
  if (!id || !current) return apiError(404, "Change not found");
  const body = await readBody(req, changePatchSchema);
  if ("response" in body) return body.response;

  const applied: string[] = [];
  const failure = await asActor(auth.principal, async () => {
    for (const step of changeEditSteps(body.data)) {
      const error = await applyStep(id, step, current);
      if (error) return { error, fields: step.fields };
      applied.push(...step.fields);
    }
    return null;
  });

  const change = await db.change.findUniqueOrThrow({ where: { id }, include: CHANGE_INCLUDE });
  if (failure) {
    return refusal(failure.error, { field: failure.fields, applied, change: serializeChange(change) });
  }
  return ok(serializeChange(change));
}
