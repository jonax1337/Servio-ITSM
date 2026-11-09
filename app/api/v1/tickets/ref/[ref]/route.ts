import { guard, ok, apiError, preflight, principalIsAgent } from "@/lib/api";
import { parseExternalRef } from "@/lib/ticket-external-ref";
import { serializeTicket } from "../../../_serializers";
import { ticketByRef } from "../../../_ticket-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * The ticket carrying this external reference: the open one (which new alerts
 * with the key land in), else the most recent one that carried it; 404 if none.
 * Non-agent tokens only find their own tickets, like GET /tickets/{id}.
 */
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await guard(req, "tickets:read");
  if ("response" in auth) return auth.response;
  const ref = parseExternalRef((await ctx.params).ref);
  const ticket = ref ? await ticketByRef(ref, principalIsAgent(auth.principal) ? null : auth.principal.userId) : null;
  if (!ticket) return apiError(404, "Ticket not found");
  return ok(serializeTicket(ticket));
}
