import { db } from "@/lib/db";
import { ok, apiError, preflight } from "@/lib/api";
import { decideApproval } from "@/lib/actions/changes";
import { approvalDecisionSchema, formOf } from "@/lib/api-itsm-input";
import { CHANGE_INCLUDE, serializeChange } from "../../../../_serializers";
import { agentGuard, asActor, readBody, recordId, refusal } from "../../../../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * Record a CAB decision. Same rules as the approvals inbox: only the seated
 * approver (or an admin) decides, never on their own change, and the board's
 * rule (unanimous / quorum / percent) settles the change to APPROVED or REJECTED.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; approvalId: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const params = await ctx.params;
  const id = recordId(params.id);
  const approval = id
    ? await db.changeApproval.findUnique({ where: { id: params.approvalId }, select: { changeId: true } })
    : null;
  if (!id || !approval || approval.changeId !== id) return apiError(404, "Approval not found");
  const body = await readBody(req, approvalDecisionSchema);
  if ("response" in body) return body.response;

  const result = await asActor(auth.principal, () =>
    decideApproval(formOf({ approvalId: params.approvalId, decision: body.data.decision, comment: body.data.comment })),
  );
  if (!result.ok) return refusal(result.error);
  const change = await db.change.findUniqueOrThrow({ where: { id }, include: CHANGE_INCLUDE });
  return ok(serializeChange(change));
}
