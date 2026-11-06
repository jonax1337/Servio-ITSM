import type { Prisma } from "@prisma/client";
import { buildTicketWhere } from "@/lib/dashboard/compute";
import { parseSlaView, slaViewWhere, sortBySlaUrgency } from "@/lib/sla-views";
import type { TicketFilters } from "@/lib/dashboard/types";
import { db } from "@/lib/db";
import { PRIORITIES, TICKET_STATUSES } from "@/lib/constants";
import { getParam, type SearchParams } from "@/lib/query";
import { applyTicketSearch } from "@/lib/search";

/** URL params the ticket list understands — the page forwards all of them to its CSV export. */
export const TICKET_LIST_PARAMS = [
  "q", "status", "priority", "type", "group", "assignee", "category", "service",
  "impact", "urgency", "source", "major", "vip", "breached", "sla", "sort", "dir",
] as const;

/** Priority and status are String columns: SQL would sort them alphabetically, so they sort by rank. */
export type RankSort = { key: "priority" | "status"; dir: "asc" | "desc" };

const RANK_ORDER = { priority: PRIORITIES, status: TICKET_STATUSES } as const;

function rankOf(key: RankSort["key"], value: string): number {
  const order: readonly string[] = RANK_ORDER[key];
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

/** Sorts by severity (priority) or lifecycle position (status); ties keep newest activity first, then highest id. */
export function sortByRank<T extends { id: number; priority: string; status: string; updatedAt: Date }>(
  rows: T[],
  { key, dir }: RankSort,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort(
    (a, b) => sign * (rankOf(key, a[key]) - rankOf(key, b[key])) ||
      b.updatedAt.getTime() - a.updatedAt.getTime() ||
      b.id - a.id,
  );
}

/** The SLA column sorts by urgency, which needs the live clock: breached first, then the nearest deadline. */
export type SlaSort = { dir: "asc" | "desc" };

type TicketPageArgs = Pick<Prisma.TicketFindManyArgs, "where" | "orderBy" | "skip" | "take">;

/**
 * Loads one window of the filtered, sorted ticket list. Rank sorts cannot be done in SQL, so they
 * sort a light {id, priority, status, updatedAt} projection in memory, then fetch just the page's rows.
 * `fetch` supplies the caller's include, so the page and the export differ only in what they load.
 */
export async function findTicketWindow<R extends { id: number }>(
  query: ReturnType<typeof ticketListQuery>,
  window: { skip: number; take: number },
  fetch: (args: TicketPageArgs) => Promise<R[]>,
): Promise<R[]> {
  const { where, orderBy, rankSort, slaSort } = query;
  if (slaSort) {
    const slim = await db.ticket.findMany({
      where,
      select: {
        id: true, status: true, createdAt: true, updatedAt: true, resolvedAt: true, resolveBreached: true,
        responseDueAt: true, resolveDueAt: true, dueAt: true, pendingSince: true, pausedMs: true,
        sla: { select: { businessCalendarId: true } },
      },
    });
    const pageIds = (await sortBySlaUrgency(slim, slaSort.dir)).slice(window.skip, window.skip + window.take).map((t) => t.id);
    const rows = await fetch({ where: { id: { in: pageIds } } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return pageIds.flatMap((id) => byId.get(id) ?? []);
  }
  if (!rankSort) return fetch({ where, orderBy, ...window });

  const slim = await db.ticket.findMany({ where, select: { id: true, priority: true, status: true, updatedAt: true } });
  const pageIds = sortByRank(slim, rankSort)
    .slice(window.skip, window.skip + window.take)
    .map((t) => t.id);
  const rows = await fetch({ where: { id: { in: pageIds } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return pageIds.flatMap((id) => byId.get(id) ?? []);
}

/**
 * `ticketListQuery` for a request: resolves the `sla` view (which needs the live SLA clock)
 * to the ticket ids currently in it, so /tickets and /api/export both get the same rows.
 */
export async function loadTicketListQuery(sp: SearchParams) {
  const view = parseSlaView(getParam(sp, "sla"));
  return ticketListQuery(sp, view ? await slaViewWhere(view) : undefined);
}

/**
 * The Prisma filter and sort for the ticket list, built from its URL params.
 * Shared by /tickets and /api/export so an export contains exactly the rows on screen.
 * `slaFilter`: the filter of the requested `sla` view, from `loadTicketListQuery`.
 */
export function ticketListQuery(sp: SearchParams, slaFilter?: Prisma.TicketWhereInput): {
  where: Prisma.TicketWhereInput;
  orderBy: Prisma.TicketOrderByWithRelationInput;
  rankSort?: RankSort;
  slaSort?: SlaSort;
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
  const filtered = buildTicketWhere(filters);
  const where: Prisma.TicketWhereInput = slaFilter ? { AND: [filtered, slaFilter] } : filtered;
  // Cross-field text search AND'd onto the filters so search narrows the list (lib/search.ts).
  applyTicketSearch(where, getParam(sp, "q"));

  const dir: "asc" | "desc" = getParam(sp, "dir") === "asc" ? "asc" : "desc";
  const ORDER: Record<string, Prisma.TicketOrderByWithRelationInput> = {
    id: { id: dir },
    title: { title: dir },
    updatedAt: { updatedAt: dir },
    createdAt: { createdAt: dir },
    requester: { requester: { name: dir } },
    assignee: { assignee: { name: dir } },
  };
  const orderBy = ORDER[getParam(sp, "sort") ?? "updatedAt"] ?? { updatedAt: dir };
  const sort = getParam(sp, "sort");
  const rankSort: RankSort | undefined = sort === "priority" || sort === "status" ? { key: sort, dir } : undefined;
  const slaSort: SlaSort | undefined = sort === "sla" ? { dir } : undefined;
  return { where, orderBy, rankSort, slaSort };
}
