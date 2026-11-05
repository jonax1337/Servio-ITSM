import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  webSearchTool,
  fetchUrlTool,
  knowledgeSearchTool,
  ticketSearchTool,
  problemSearchTool,
  changeSearchTool,
  resolveGroupId,
  parseTicketId,
} from "@/lib/ai-tools";
import { PRIORITIES, TICKET_STATUSES, ticketRef } from "@/lib/constants";
import { ticketRelations, TICKET_RELATIONS_SELECT } from "@/lib/ai-operations/ticket-relations";

/**
 * The GENERAL standalone Sable tool set (the /assistant surface, AGENT+).
 *
 * Read/web tools are re-used by reference from the ticket-bound chat
 * (`lib/ai-tools.ts`). The personal work tools (`list_my_tickets`,
 * `list_team_tickets`, `list_tickets`, `get_ticket`) are USER-SCOPED, so they
 * are built per-request via `buildAssistantGeneralTools(ctx)` — the execute
 * closures capture the acting agent's id and team memberships (never trust the
 * model to pass "who am I"). `propose_create_ticket` is PROPOSE-only.
 */

/** Who Sable is acting for — captured server-side, never model-supplied. */
export type AssistantUserContext = {
  userId: string;
  name: string;
  groupIds: string[];
};

/** Statuses that count as "active work" (not resolved/closed/cancelled). */
const ACTIVE_STATUSES = ["NEW", "OPEN", "PENDING", "ON_HOLD"] as const;

const TICKET_SELECT = {
  id: true,
  title: true,
  type: true,
  status: true,
  priority: true,
  updatedAt: true,
  resolveDueAt: true,
  responseBreached: true,
  resolveBreached: true,
  requester: { select: { name: true, email: true } },
  assignee: { select: { name: true } },
  group: { select: { name: true } },
  category: { select: { name: true } },
} as const;

type TicketRow = {
  id: number;
  title: string;
  type: string;
  status: string;
  priority: string;
  updatedAt: Date;
  resolveDueAt: Date | null;
  responseBreached: boolean;
  resolveBreached: boolean;
  requester: { name: string | null; email: string | null } | null;
  assignee: { name: string | null } | null;
  group: { name: string | null } | null;
  category: { name: string | null } | null;
};

function fmt(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 16).replace("T", " ") : null;
}

function shapeTicket(t: TicketRow) {
  return {
    ref: ticketRef(t.id, t.type),
    title: t.title,
    status: t.status,
    priority: t.priority,
    requester: t.requester?.name ?? t.requester?.email ?? null,
    assignee: t.assignee?.name ?? null,
    team: t.group?.name ?? null,
    category: t.category?.name ?? null,
    updated: fmt(t.updatedAt),
    dueAt: fmt(t.resolveDueAt),
    breached: t.resolveBreached || t.responseBreached || false,
  };
}

async function runTicketQuery(where: Record<string, unknown>, limit: number) {
  const rows = (await db.ticket.findMany({
    where,
    take: Math.min(Math.max(limit, 1), 25),
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    select: TICKET_SELECT,
  })) as TicketRow[];
  if (!rows.length) return { count: 0, tickets: [], note: "No matching tickets." };
  return { count: rows.length, tickets: rows.map(shapeTicket) };
}

/**
 * Build the GENERAL standalone tool set for a specific agent. The personal work
 * tools capture `ctx` so the model can ask about "my" tickets without being able
 * to spoof identity. Static search/web tools are reused by reference.
 */
export function buildAssistantGeneralTools(ctx: AssistantUserContext): ToolSet {
  const listMyTickets = tool({
    description:
      "List tickets currently ASSIGNED TO YOU (the signed-in agent) — your personal work queue. " +
      "Shows active (unresolved) tickets by default, most urgent first. Use this whenever the user " +
      "asks about 'my tickets', 'what am I working on', 'what's assigned to me', or 'my queue'.",
    inputSchema: z.object({
      status: z.enum(TICKET_STATUSES).optional().describe("filter to one status; omit for all active tickets"),
      priority: z.enum(PRIORITIES).optional(),
      limit: z.number().int().min(1).max(25).optional(),
    }),
    execute: async ({ status, priority, limit }) => {
      const where: Record<string, unknown> = { assigneeId: ctx.userId };
      where.status = status ?? { in: ACTIVE_STATUSES };
      if (priority) where.priority = priority;
      return runTicketQuery(where, limit ?? 15);
    },
  });

  const listTeamTickets = tool({
    description:
      "List tickets in YOUR team(s)' queues — e.g. unassigned work you could pick up. Defaults to " +
      "unassigned, active tickets. Use for 'what can I pick up', 'my team's open tickets', 'the backlog'.",
    inputSchema: z.object({
      unassignedOnly: z.boolean().optional().describe("only tickets with no assignee (default true)"),
      status: z.enum(TICKET_STATUSES).optional(),
      priority: z.enum(PRIORITIES).optional(),
      limit: z.number().int().min(1).max(25).optional(),
    }),
    execute: async ({ unassignedOnly = true, status, priority, limit }) => {
      if (!ctx.groupIds.length) {
        return { count: 0, tickets: [], note: "You are not a member of any team." };
      }
      const where: Record<string, unknown> = { groupId: { in: ctx.groupIds } };
      if (unassignedOnly) where.assigneeId = null;
      where.status = status ?? { in: ACTIVE_STATUSES };
      if (priority) where.priority = priority;
      return runTicketQuery(where, limit ?? 15);
    },
  });

  const listTickets = tool({
    description:
      "List tickets by STRUCTURED filters (assignee, status, priority, team) — e.g. 'unassigned critical " +
      "tickets', 'open tickets for the Network team'. For free-text keyword search use search_tickets instead.",
    inputSchema: z.object({
      assignee: z.enum(["me", "unassigned", "anyone"]).optional().describe("whose tickets (default anyone)"),
      status: z.enum(TICKET_STATUSES).optional().describe("omit for all active statuses"),
      priority: z.enum(PRIORITIES).optional(),
      team: z.string().optional().describe("team name from the directory"),
      limit: z.number().int().min(1).max(25).optional(),
    }),
    execute: async ({ assignee, status, priority, team, limit }) => {
      const where: Record<string, unknown> = {};
      if (assignee === "me") where.assigneeId = ctx.userId;
      else if (assignee === "unassigned") where.assigneeId = null;
      where.status = status ?? { in: ACTIVE_STATUSES };
      if (priority) where.priority = priority;
      if (team) {
        const g = await resolveGroupId(team);
        if (!g) return { count: 0, tickets: [], note: `No team matches "${team}".` };
        where.groupId = g.id;
      }
      return runTicketQuery(where, limit ?? 15);
    },
  });

  const getTicket = tool({
    description:
      "Get the FULL details of ONE ticket by its ref or number (e.g. 'INC-0042' or '42'): status, priority, " +
      "impact/urgency, requester, assignee, team, category, SLA response/resolve due dates and breaches, the " +
      "description, parent ticket, child tickets, merge info and the latest comments — so you can help the agent actually work on it.",
    inputSchema: z.object({
      ref: z.string().describe("ticket ref or number, e.g. 'INC-0042' or '42'"),
    }),
    execute: async ({ ref }) => {
      const id = parseTicketId(ref);
      if (!id) return { ok: false, error: `Cannot parse a ticket number from "${ref}".` };
      const t = await db.ticket.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          priority: true,
          impact: true,
          urgency: true,
          description: true,
          createdAt: true,
          updatedAt: true,
          responseDueAt: true,
          resolveDueAt: true,
          responseBreached: true,
          resolveBreached: true,
          requester: { select: { name: true, email: true } },
          assignee: { select: { name: true } },
          group: { select: { name: true } },
          category: { select: { name: true } },
          service: { select: { name: true } },
          sla: { select: { name: true } },
          ...TICKET_RELATIONS_SELECT,
          comments: {
            orderBy: { createdAt: "desc" },
            take: 6,
            select: {
              body: true,
              isInternal: true,
              createdAt: true,
              author: { select: { name: true } },
            },
          },
        },
      });
      if (!t) return { ok: false, error: `No ticket ${ref} found.` };
      return {
        ok: true,
        ticket: {
          ref: ticketRef(t.id, t.type),
          title: t.title,
          status: t.status,
          priority: t.priority,
          impact: t.impact,
          urgency: t.urgency,
          requester: t.requester?.name ?? t.requester?.email ?? null,
          assignee: t.assignee?.name ?? "Unassigned",
          team: t.group?.name ?? null,
          category: t.category?.name ?? null,
          service: t.service?.name ?? null,
          sla: t.sla?.name ?? null,
          responseDueAt: fmt(t.responseDueAt),
          resolveDueAt: fmt(t.resolveDueAt),
          breached: t.responseBreached || t.resolveBreached || false,
          created: fmt(t.createdAt),
          updated: fmt(t.updatedAt),
          description: (t.description || "").slice(0, 800),
          ...ticketRelations(t),
          comments: t.comments
            .slice()
            .reverse()
            .map((c) => ({
              author: c.author?.name ?? "Unknown",
              internal: c.isInternal,
              at: fmt(c.createdAt),
              text: (c.body || "").replace(/\s+/g, " ").slice(0, 400),
            })),
        },
      };
    },
  });

  const draftDocument = tool({
    description:
      "Hand a LONG document or SCRIPT draft to an editable side canvas the user can review, edit, publish " +
      "or SAVE INTO THE ACTIVE PROJECT's files — use for runbooks, RCAs, change docs, Knowledge Base drafts, " +
      "or code/scripts (anything longer than a chat reply). Write the full document body as markdown (for a " +
      "script, put the code in a fenced code block). It opens beside the chat. This does NOT save anything: " +
      "the user edits it in the canvas and chooses whether to publish or save. Call it once with the complete " +
      "draft. When drafting a SCRIPT or a file that should keep a sensible name/extension, ALSO pass `filename` " +
      "(e.g. 'deploy.sh', 'migrate.py', 'runbook.md') and/or `language` (e.g. 'bash', 'python', 'sql', " +
      "'markdown') so it saves with the right extension.",
    inputSchema: z.object({
      title: z.string().min(1).max(160).describe("a short document title"),
      markdown: z.string().min(1).describe("the full document body as markdown"),
      filename: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe("optional file name with extension for saving (e.g. 'deploy.sh', 'runbook.md')"),
      language: z
        .string()
        .min(1)
        .max(40)
        .optional()
        .describe("optional code/document language, e.g. 'bash', 'python', 'sql', 'markdown'"),
    }),
    execute: async ({ title, markdown, filename, language }) => {
      // Pure hand-off: no mutation. The client canvas renders off this result.
      return { ok: true, title, markdown, filename, language };
    },
  });

  return {
    // read / web (reused, stateless)
    web_search: webSearchTool,
    fetch_url: fetchUrlTool,
    search_knowledge_base: knowledgeSearchTool,
    search_tickets: ticketSearchTool,
    search_problems: problemSearchTool,
    search_changes: changeSearchTool,
    // personal work (user-scoped)
    list_my_tickets: listMyTickets,
    list_team_tickets: listTeamTickets,
    list_tickets: listTickets,
    get_ticket: getTicket,
    // Long-document hand-off to the editable canvas (no mutation)
    draft_document: draftDocument,
    // Write actions (create/update/...) live in the RBAC operation registry
    // (lib/ai-operations) and are surfaced as propose_* tools by the caller.
  };
}
