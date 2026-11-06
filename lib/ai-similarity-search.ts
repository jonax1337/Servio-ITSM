/**
 * Finds tickets that look like a given ticket: open ones first, then recently
 * resolved ones. Uses the local lexical scorer (lib/ai-similarity.ts), so
 * nothing leaves the server and it works with AI switched off.
 */
import { db } from "@/lib/db";
import { OPEN_TICKET_STATUSES, ticketRef } from "@/lib/constants";
import { orderOpenFirst, rankSimilar, similarityReason, type SimilarityDoc } from "@/lib/ai-similarity";
import { loadInsightConfig } from "@/lib/ai-insights";

const POOL_SIZE = 300;
const RECENTLY_RESOLVED_DAYS = 90;
const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 5;

export type SimilarTicket = {
  id: number;
  ref: string;
  title: string;
  status: string;
  open: boolean;
  /** 0..1 */
  score: number;
  reason: string;
};

const POOL_SELECT = {
  id: true, prefix: true, title: true, description: true, status: true, categoryId: true, serviceId: true,
} as const;

const toDoc = (t: { id: number; title: string; description: string; categoryId: string | null; serviceId: string | null }): SimilarityDoc => ({
  id: t.id, focus: t.title, context: t.description, categoryId: t.categoryId, serviceId: t.serviceId,
});

/** Best matches for a ticket, excluding itself and tickets it is already linked to. */
export async function findSimilarTickets(ticketId: number, limit = DEFAULT_LIMIT): Promise<SimilarTicket[]> {
  const target = await db.ticket.findUnique({
    where: { id: ticketId },
    select: {
      ...POOL_SELECT,
      linksFrom: { select: { linkedTicketId: true } },
      linksTo: { select: { ticketId: true } },
    },
  });
  if (!target) return [];

  const resolvedSince = new Date(Date.now() - RECENTLY_RESOLVED_DAYS * DAY_MS);
  const [open, resolved, { similarityThreshold }] = await Promise.all([
    db.ticket.findMany({
      where: { status: { in: [...OPEN_TICKET_STATUSES] }, mergedIntoId: null, id: { not: ticketId } },
      select: POOL_SELECT,
      orderBy: { updatedAt: "desc" },
      take: POOL_SIZE,
    }),
    db.ticket.findMany({
      where: { status: { in: ["RESOLVED", "CLOSED"] }, resolvedAt: { gte: resolvedSince }, mergedIntoId: null, id: { not: ticketId } },
      select: POOL_SELECT,
      orderBy: { resolvedAt: "desc" },
      take: POOL_SIZE,
    }),
    loadInsightConfig(),
  ]);

  const linked = new Set([...target.linksFrom.map((l) => l.linkedTicketId), ...target.linksTo.map((l) => l.ticketId)]);
  const pool = new Map([...open, ...resolved].filter((t) => !linked.has(t.id)).map((t) => [t.id, t]));
  const matches = rankSimilar(toDoc(target), [...pool.values()].map(toDoc), similarityThreshold);

  const candidates = matches.flatMap((match) => {
    const ticket = pool.get(match.id);
    if (!ticket) return [];
    return [{
      id: ticket.id,
      ref: ticketRef(ticket.id, ticket.prefix),
      title: ticket.title,
      status: ticket.status,
      open: (OPEN_TICKET_STATUSES as readonly string[]).includes(ticket.status),
      score: match.score,
      reason: similarityReason(match),
    }];
  });
  return orderOpenFirst(candidates).slice(0, limit);
}
