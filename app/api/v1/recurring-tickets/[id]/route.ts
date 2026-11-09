import { db } from "@/lib/db";
import { ok, apiError, preflight } from "@/lib/api";
import { deleteRecurringTicket, updateRecurringTicket } from "@/lib/actions/recurring-tickets";
import { formOf, snakeKeys } from "@/lib/api-itsm-input";
import { recurringTicketPatchForm, recurringTicketPatchSchema } from "@/lib/recurring-ticket-input";
import { presentRecurringTicket } from "../../_serializers";
import { agentGuard, asActor, readBody, refusal } from "../../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "recurring:read");
  if ("response" in auth) return auth.response;
  const row = await db.recurringTicket.findUnique({ where: { id: (await ctx.params).id } });
  if (!row) return apiError(404, "Recurring ticket not found");
  return ok(presentRecurringTicket(row));
}

/**
 * Edit a schedule (MANAGER or above). Fields left out keep their value; `null`
 * clears an id. A changed recurrence (or `active: true` after a pause) recomputes
 * `next_due_at` from the next occurrence that is not due yet.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "recurring:write");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const current = await db.recurringTicket.findUnique({ where: { id } });
  if (!current) return apiError(404, "Recurring ticket not found");
  const body = await readBody(req, recurringTicketPatchSchema);
  if ("response" in body) return body.response;
  const result = await asActor(auth.principal, () => updateRecurringTicket(undefined, recurringTicketPatchForm(current, body.data)));
  if (!result?.ok) {
    if (result?.fieldErrors) return apiError(422, "Validation failed", snakeKeys(result.fieldErrors));
    return refusal(result?.error ?? "The request was refused.");
  }
  return ok(presentRecurringTicket(await db.recurringTicket.findUniqueOrThrow({ where: { id } })));
}

/** Delete a schedule (MANAGER or above). Tickets it already created stay. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "recurring:write");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  if (!(await db.recurringTicket.findUnique({ where: { id }, select: { id: true } }))) return apiError(404, "Recurring ticket not found");
  const result = await asActor(auth.principal, () => deleteRecurringTicket(formOf({ id })));
  if (!result.ok) return refusal(result.error ?? "The request was refused.");
  return ok({ id, deleted: true });
}
