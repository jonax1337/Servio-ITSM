import { db } from "@/lib/db";
import { ok, apiError, preflight } from "@/lib/api";
import { submitChangeForApproval, updateChangeField } from "@/lib/actions/changes";
import { changeTransitionSchema, formOf } from "@/lib/api-itsm-input";
import { CHANGE_INCLUDE, serializeChange } from "../../../_serializers";
import { agentGuard, asActor, readBody, recordId, refusal } from "../../../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * Move a change along its lifecycle, with the console's rules:
 *
 * - `to: "APPROVAL"` submits a DRAFT for approval: plans and window required,
 *   freeze windows checked (an EMERGENCY change may pass one with a
 *   `justification`), the CAB is seated and notified — or a standard change
 *   from an active template is approved straight away.
 * - `APPROVED`/`REJECTED` are set only by the board: use
 *   POST /changes/{id}/approvals/{approval_id}.
 * - Every other move follows the configured transition map and role gates.
 *   CLOSED/FAILED need an `outcome` (and `closure_notes` where the rules ask
 *   for them), CANCELLED needs a `cancel_reason`.
 *
 * 409 when the move is not allowed, with the console's reason as the message.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const id = recordId((await ctx.params).id);
  const exists = id ? await db.change.findUnique({ where: { id }, select: { id: true } }) : null;
  if (!id || !exists) return apiError(404, "Change not found");
  const body = await readBody(req, changeTransitionSchema);
  if ("response" in body) return body.response;
  const { to, outcome, closure_notes, cancel_reason, justification } = body.data;

  const result = await asActor(auth.principal, () =>
    to === "APPROVAL"
      ? submitChangeForApproval(formOf({ id, justification }))
      : updateChangeField(
          formOf({ id, field: "status", value: to, outcome, closureNotes: closure_notes, cancelReason: cancel_reason }),
        ),
  );
  if (!result.ok) {
    return refusal(result.error, "needsJustification" in result && result.needsJustification ? { needs_justification: true } : undefined);
  }
  const change = await db.change.findUniqueOrThrow({ where: { id }, include: CHANGE_INCLUDE });
  return ok(serializeChange(change));
}
