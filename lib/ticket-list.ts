import type { Prisma } from "@prisma/client";
import { buildTicketWhere } from "@/lib/dashboard/compute";
import type { TicketFilters } from "@/lib/dashboard/types";
import { getParam, type SearchParams } from "@/lib/query";
import { applyTicketSearch } from "@/lib/search";

/** URL params the ticket list understands — the page forwards all of them to its CSV export. */
export const TICKET_LIST_PARAMS = [
  "q", "status", "priority", "type", "group", "assignee", "category", "service",
  "impact", "urgency", "source", "major", "vip", "breached", "sort", "dir",
] as const;

/**
 * The Prisma filter and sort for the ticket list, built from its URL params.
 * Shared by /tickets and /api/export so an export contains exactly the rows on screen.
 */
export function ticketListQuery(sp: SearchParams): {
  where: Prisma.TicketWhereInput;
  orderBy: Prisma.TicketOrderByWithRelationInput;
} {
  // Same builder as the dashboard widgets, so widget drill-down links match exactly.
  const filters: TicketFilters = {
    status: getParam(sp, "status"),
    priority: getParam(sp, "priority"),
    type: getParam(sp, "type"),
    group: getParam(sp, "group"),
    assignee: getParam(sp, "assignee"),
    category: getParam(sp, "category"),
    service: getParam(sp, "service"),
    impact: getParam(sp, "impact"),
    urgency: getParam(sp, "urgency"),
    source: getParam(sp, "source"),
    major: getParam(sp, "major"),
    vip: getParam(sp, "vip"),
    breached: getParam(sp, "breached"),
  };
  const where: Prisma.TicketWhereInput = buildTicketWhere(filters);
  // Cross-field text search AND'd onto the filters so search narrows the list (lib/search.ts).
  applyTicketSearch(where, getParam(sp, "q"));

  const dir: "asc" | "desc" = getParam(sp, "dir") === "asc" ? "asc" : "desc";
  const ORDER: Record<string, Prisma.TicketOrderByWithRelationInput> = {
    id: { id: dir },
    title: { title: dir },
    status: { status: dir },
    priority: { priority: dir },
    updatedAt: { updatedAt: dir },
    createdAt: { createdAt: dir },
    requester: { requester: { name: dir } },
    assignee: { assignee: { name: dir } },
  };
  const orderBy = ORDER[getParam(sp, "sort") ?? "updatedAt"] ?? { updatedAt: dir };
  return { where, orderBy };
}
