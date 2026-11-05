import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ticketListQuery } from "@/lib/ticket-list";
import { requireUser, isAgent } from "@/lib/session";
import { csvResponse } from "@/lib/csv";
import { fetchAuditLogForExport, type AuditLogFilters } from "@/lib/actions/audit-log";
import { ticketRef } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streaming CSV export endpoint. `?type=` selects the dataset:
 *   - audit   → the audit log (ADMIN only), honouring the viewer's filters.
 *   - tickets → the ticket list (AGENT+), a dashboard-friendly snapshot.
 *
 * Each branch enforces its own authorization; `requireUser` redirects
 * unauthenticated callers to /login.
 */
export async function GET(req: Request) {
  const me = await requireUser();
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "audit";
  const sp = url.searchParams;

  switch (type) {
    case "audit": {
      // ADMIN gate + filters live inside fetchAuditLogForExport.
      const filters: AuditLogFilters = {
        userId: sp.get("userId") ?? undefined,
        entity: sp.get("entity") ?? undefined,
        action: sp.get("action") ?? undefined,
        from: sp.get("from") ?? undefined,
        to: sp.get("to") ?? undefined,
        q: sp.get("q") ?? undefined,
      };
      const rows = await fetchAuditLogForExport(filters);
      const stamp = new Date().toISOString().slice(0, 10);
      return csvResponse(
        `audit-log-${stamp}`,
        rows.map((r) => ({
          timestamp: r.createdAt,
          action: r.action,
          entity: r.entity,
          entityId: r.entityId,
          actor: r.actorName ?? r.actorEmail ?? "System",
          actorEmail: r.actorEmail ?? "",
          summary: r.summary ?? "",
          ip: r.ip ?? "",
        })),
        ["timestamp", "action", "entity", "entityId", "actor", "actorEmail", "summary", "ip"],
      );
    }

    case "tickets": {
      // Ticket data is agent-facing; end users must not export the org's tickets.
      if (!isAgent(me.role)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      // Exactly the rows the list shows for the same filters/search/sort (lib/ticket-list.ts).
      // `type` selects the export itself, so the list's ticket-type filter travels as `ticketType`.
      const { where, orderBy } = ticketListQuery({ ...Object.fromEntries(sp), type: sp.get("ticketType") ?? undefined });
      const tickets = await db.ticket.findMany({
        where,
        orderBy,
        take: 10_000,
        include: {
          requester: { select: { name: true, email: true } },
          assignee: { select: { name: true, email: true } },
        },
      });
      const stamp = new Date().toISOString().slice(0, 10);
      return csvResponse(
        `tickets-${stamp}`,
        tickets.map((t) => ({
          ref: ticketRef(t.id, t.prefix),
          title: t.title,
          type: t.type,
          status: t.status,
          priority: t.priority,
          requester: t.requester?.name ?? t.requester?.email ?? "",
          assignee: t.assignee?.name ?? t.assignee?.email ?? "",
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        })),
        ["ref", "title", "type", "status", "priority", "requester", "assignee", "createdAt", "updatedAt"],
      );
    }

    default:
      return NextResponse.json({ error: `unknown export type: ${type}` }, { status: 400 });
  }
}
