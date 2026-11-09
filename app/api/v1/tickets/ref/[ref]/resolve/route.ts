import { db } from "@/lib/db";
import { ok, apiError, preflight } from "@/lib/api";
import { camelizeBody } from "@/lib/api-case";
import { formOf } from "@/lib/api-itsm-input";
import { ticketResolveSchema } from "@/lib/api-ticket-input";
import { parseExternalRef } from "@/lib/ticket-external-ref";
import { setTicketResolution } from "@/lib/actions/tickets";
import { TICKET_INCLUDE, serializeTicket } from "../../../../_serializers";
import { agentGuard, asActor, refusal } from "../../../../_itsm";
import { openTicketByRef } from "../../../../_ticket-ref";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * Recovery of a monitored alert: resolve the OPEN ticket carrying this external
 * reference through the console's resolution action (setTicketResolution) as
 * the token's owner — the configured workflow map and role gates, the merge and
 * approval rules, SLA stamping, the resolution comment and mail, automations.
 * 404 when no ticket with the key is open; a refusal keeps the console's
 * message (409 for the workflow, 403 when the owner may not act on the ticket).
 * The body is optional.
 */
export async function POST(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "tickets:write");
  if ("response" in auth) return auth.response;
  const ref = parseExternalRef((await ctx.params).ref);
  const open = ref ? await openTicketByRef(ref) : null;
  if (!open) return apiError(404, "No open ticket carries this external_ref");

  let body: unknown = {};
  const raw = await req.text();
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      return apiError(400, "Invalid JSON body");
    }
  }
  // snake_case keys are accepted too (lib/api-case.ts).
  const normalized = camelizeBody(body);
  if ("conflict" in normalized) return apiError(422, "Validation failed", { _: normalized.conflict.map((c) => `Conflicting values for ${c}`) });
  const parsed = ticketResolveSchema.safeParse(normalized.body);
  if (!parsed.success) {
    // Strict body: an unknown key is a form error ("Unrecognized key"), reported under `_`.
    const flat = parsed.error.flatten();
    return apiError(422, "Validation failed", { ...flat.fieldErrors, ...(flat.formErrors.length ? { _: flat.formErrors } : {}) });
  }
  const { resolutionNote, resolutionCode, internal } = parsed.data;

  const result = await asActor(auth.principal, () =>
    setTicketResolution(formOf({
      id: open.id,
      status: "RESOLVED",
      code: resolutionCode,
      note: resolutionNote,
      isInternal: internal ? "on" : undefined,
    })),
  );
  if (!result.ok) return refusal(result.error ?? "The resolution was refused.", { ticket: serializeTicket(open) });

  const ticket = await db.ticket.findUniqueOrThrow({ where: { id: open.id }, include: TICKET_INCLUDE });
  return ok(serializeTicket(ticket));
}
