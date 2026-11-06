import { z } from "zod";
import { db } from "@/lib/db";
import { parseTicketId } from "@/lib/ai-tools";
import { AI_INSIGHT_KINDS, problemRef, ticketRef } from "@/lib/constants";
import { findSimilarTickets } from "@/lib/ai-similarity-search";
import { createProblemFromCluster } from "@/lib/ai-insights-handling";
import type { AiOperation } from "../types";
import { ok, err, str } from "../helpers";

/**
 * Sable insights: find similar / duplicate tickets, list the open insights
 * (incident clusters, knowledge gaps) and turn a cluster into a problem. The
 * write op reuses the same handler as the Insights page, so its role check,
 * linking rules and audit trail are identical.
 */

const MAX_SIMILAR = 10;
const DEFAULT_SIMILAR = 5;
const MAX_LISTED_INSIGHTS = 25;

export const OPERATIONS: AiOperation[] = [
  {
    id: "ticket.find_similar",
    group: "Insights",
    kind: "read",
    minRole: "AGENT",
    description:
      "Find tickets similar to a given ticket (possible duplicates or earlier occurrences): open tickets first, then recently resolved ones. " +
      "Returns each candidate's ref, title, status, match score (0..1) and the reason it matched.",
    input: z.object({
      ticket: z.string().describe("ticket reference, e.g. INC-0042 or 42"),
      limit: z.number().int().min(1).max(MAX_SIMILAR).optional().describe(`how many candidates (default ${DEFAULT_SIMILAR})`),
    }),
    run: async (a) => {
      const id = parseTicketId(String(a.ticket ?? ""));
      if (!id) return err("Give a ticket reference such as INC-0042.");
      const ticket = await db.ticket.findUnique({ where: { id }, select: { id: true, prefix: true } });
      if (!ticket) return err(`Ticket not found: ${a.ticket}`);
      const similar = await findSimilarTickets(id, typeof a.limit === "number" ? a.limit : DEFAULT_SIMILAR);
      const ref = ticketRef(ticket.id, ticket.prefix);
      if (similar.length === 0) return ok(`No similar tickets found for ${ref}.`, { tickets: [] });
      return ok(`${similar.length} ticket(s) similar to ${ref}.`, { tickets: similar });
    },
  },
  {
    id: "insight.list",
    group: "Insights",
    kind: "read",
    minRole: "AGENT",
    description:
      "List open Sable insights: incident clusters (several similar open incidents without a problem) and knowledge gaps (tickets resolved the same way with no article). " +
      "Use the returned `id` with insight.problem_from_cluster.",
    input: z.object({
      kind: z.enum(AI_INSIGHT_KINDS).optional().describe("CLUSTER or KB_GAP; omit for both"),
    }),
    run: async (a) => {
      const kind = str(a.kind);
      const rows = await db.aiInsight.findMany({
        where: { status: "OPEN", ...(kind ? { kind } : {}) },
        orderBy: { createdAt: "desc" },
        take: MAX_LISTED_INSIGHTS,
        select: {
          id: true, kind: true, title: true, summary: true,
          tickets: { select: { ticket: { select: { id: true, prefix: true } } } },
        },
      });
      if (rows.length === 0) return ok("There are no open insights.", { insights: [] });
      const insights = rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        summary: row.summary,
        tickets: row.tickets.map((t) => ticketRef(t.ticket.id, t.ticket.prefix)),
      }));
      return ok(`${insights.length} open insight(s).`, { insights });
    },
  },
  {
    id: "insight.problem_from_cluster",
    group: "Insights",
    kind: "write",
    minRole: "AGENT",
    description:
      "Create a problem from an incident-cluster insight and link the cluster's tickets to it. Only for insights of kind CLUSTER; get the id from insight.list.",
    input: z.object({
      insightId: z.string().min(1).describe("id of the CLUSTER insight, from insight.list"),
    }),
    label: () => "Create a problem from the incident cluster and link its tickets",
    run: async (a, ctx) => {
      const result = await createProblemFromCluster(String(a.insightId ?? ""), { id: ctx.userId, role: ctx.role });
      if (!result.ok) return err(result.error);
      const skipped = result.skipped > 0 ? `, ${result.skipped} left out` : "";
      return ok(`Created ${problemRef(result.problemId)} and linked ${result.linked} ticket(s)${skipped}.`, {
        problemId: result.problemId,
      });
    },
  },
];
