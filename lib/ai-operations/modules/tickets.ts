import { z } from "zod";
import { db } from "@/lib/db";
import {
  updateTicketField,
  addTicketComment,
  setTicketResolution,
  escalateTicket,
  linkTicket,
  addTask,
  addWorkLog,
  toggleWatch,
  toggleMajorIncident,
} from "@/lib/actions/tickets";
import { createTicketCore } from "@/lib/ticket-core";
import {
  resolveGroupId,
  resolveCategoryId,
  resolveAgentId,
  parseTicketId,
  categoryNotFoundHint,
  groupNotFoundHint,
} from "@/lib/ai-tools";
import { linkStagedAttachments } from "@/lib/portal-tickets";
import {
  TICKET_TYPES,
  PRIORITIES,
  IMPACT_URGENCY,
  RESOLUTION_CODES,
  ticketRef,
} from "@/lib/constants";
import type { AiOperation } from "../types";
import { ok, err, str, toFormData, coerceEnum, richHtml, verifyFieldWrite } from "../helpers";

/**
 * Tickets. Reference module shape — export `OPERATIONS: AiOperation[]`, one entry
 * per capability. STATEFUL mutations reuse the real (non-redirecting) actions from
 * `@/lib/actions/tickets` via toFormData, so the status state-machine, SLA clock,
 * notifications and automations all run exactly as they would from the UI.
 */

/** Resolve a ref ("INC-0042" / "42") to an existing ticket id + type, or null. */
async function resolveTicket(ref: unknown) {
  const id = parseTicketId(String(ref ?? ""));
  if (!id) return null;
  return db.ticket.findUnique({ where: { id }, select: { id: true, type: true } });
}

const FIELD_ENUMS: Record<string, readonly string[]> = {
  status: [
    "NEW", "OPEN", "IN_PROGRESS", "PENDING", "ON_HOLD", "RESOLVED", "CLOSED", "CANCELLED",
  ],
  priority: PRIORITIES,
  impact: IMPACT_URGENCY,
  urgency: IMPACT_URGENCY,
  type: TICKET_TYPES,
};

export const OPERATIONS: AiOperation[] = [
  {
    id: "ticket.create",
    group: "Tickets",
    kind: "write",
    minRole: "AGENT",
    description:
      "Create a new ticket (incident or request). Runs the full pipeline — SLA clock, routing, requester mail and automations. Optionally set type, priority, a category and team by name, and a requester by email (defaults to you).",
    input: z.object({
      title: z.string().min(3).describe("ticket title"),
      description: z.string().optional(),
      type: z.enum(TICKET_TYPES).optional().describe("INCIDENT or REQUEST"),
      priority: z.enum(PRIORITIES).optional(),
      category: z.string().optional().describe("category name"),
      team: z.string().optional().describe("team/group name to route to"),
      requesterEmail: z.string().optional().describe("requester's email; defaults to you"),
      attachFiles: z
        .boolean()
        .optional()
        .describe(
          "Whether to attach the file(s) the user added to THIS chat turn to the new ticket. Defaults to true. Set false only if their attachment isn't relevant to this ticket.",
        ),
      attachmentIds: z
        .array(z.string())
        .optional()
        .describe("System-managed — leave unset; the server fills this with the turn's staged file ids."),
    }),
    label: (a) => `Create ticket “${a.title}”`,
    run: async (a, ctx) => {
      const title = str(a.title);
      if (!title || title.length < 3) return err("Ticket title is too short.");

      const type = (coerceEnum(a.type, TICKET_TYPES) ?? "INCIDENT") as (typeof TICKET_TYPES)[number];
      const priority = (coerceEnum(a.priority, PRIORITIES) ?? "MEDIUM") as (typeof PRIORITIES)[number];

      const categoryName = str(a.category);
      const category = categoryName ? await resolveCategoryId(categoryName) : null;
      if (categoryName && !category)
        return err(`Category not found: ${a.category}.${await categoryNotFoundHint(categoryName)}`);

      const teamName = str(a.team);
      const team = teamName ? await resolveGroupId(teamName) : null;
      if (teamName && !team)
        return err(`Team not found: ${a.team}.${await groupNotFoundHint(teamName)}`);

      let requesterId = ctx.userId;
      const email = str(a.requesterEmail);
      if (email) {
        const requester = await db.user.findUnique({ where: { email }, select: { id: true } });
        if (!requester) return err(`No user found with email: ${email}`);
        requesterId = requester.id;
      }

      const ticket = await createTicketCore(
        {
          title,
          description: str(a.description) ?? "",
          descriptionHtml: richHtml(a.description),
          type,
          priority,
          impact: "MEDIUM",
          urgency: "MEDIUM",
          source: "AGENT",
          requesterId,
          requestedByUserId: null,
          assigneeId: null,
          groupId: team?.id ?? null,
          categoryId: category?.id ?? null,
          serviceId: null,
          slaId: null,
        },
        ctx.userId,
      );
      // Link any files the user attached to this chat turn (staged at turn time,
      // ids injected into the proposal by the route) onto the new ticket.
      if (a.attachFiles !== false && Array.isArray(a.attachmentIds) && a.attachmentIds.length) {
        await linkStagedAttachments(ctx.userId, ticket.id, a.attachmentIds.map(String));
      }
      return ok(`Created ${ticketRef(ticket.id, ticket.type)} — "${title}"`);
    },
  },
  {
    id: "ticket.update_field",
    group: "Tickets",
    kind: "write",
    minRole: "AGENT",
    description:
      "Change one field on a ticket. Field is one of: status, priority, impact, urgency, type, team, category, assignee, service, sla. " +
      "Use a human value/name (e.g. status 'RESOLVED', team 'Infrastructure', assignee 'Nora K', service 'Email', sla 'Gold'). Runs the real state-machine, SLA clock and notifications.",
    input: z.object({
      ref: z.string().describe("ticket ref or number, e.g. 'INC-0042' or '42'"),
      field: z.enum([
        "status", "priority", "impact", "urgency", "type",
        "team", "category", "assignee", "service", "sla",
      ]),
      value: z.string().describe("target value or name"),
    }),
    label: (a) => `Set ${a.field} = “${a.value}” on ${a.ref}`,
    run: async (a, _ctx) => {
      const ticket = await resolveTicket(a.ref);
      if (!ticket) return err(`Ticket not found: ${a.ref}`);
      const field = String(a.field);
      const value = str(a.value);
      if (!value) return err("A value is required.");

      let realField = field;
      let realValue = value;

      if (field === "team") {
        const g = await resolveGroupId(value);
        if (!g) return err(`Team not found: ${value}.${await groupNotFoundHint(value)}`);
        realField = "groupId";
        realValue = g.id;
      } else if (field === "category") {
        const c = await resolveCategoryId(value);
        if (!c) return err(`Category not found: ${value}.${await categoryNotFoundHint(value)}`);
        realField = "categoryId";
        realValue = c.id;
      } else if (field === "assignee") {
        const u = await resolveAgentId(value);
        if (!u) return err(`Agent not found: ${value}`);
        realField = "assigneeId";
        realValue = u.id;
      } else if (field === "service") {
        const s = await db.service.findFirst({
          where: { name: { contains: value } },
          select: { id: true },
        });
        if (!s) return err(`Service not found: ${value}`);
        realField = "serviceId";
        realValue = s.id;
      } else if (field === "sla") {
        const s = await db.sLA.findFirst({
          where: { name: { contains: value } },
          select: { id: true },
        });
        if (!s) return err(`SLA not found: ${value}`);
        realField = "slaId";
        realValue = s.id;
      } else if (field in FIELD_ENUMS) {
        const up = coerceEnum(value, FIELD_ENUMS[field]);
        if (!up) return err(`Invalid ${field} "${value}". Allowed: ${FIELD_ENUMS[field].join(", ")}.`);
        realValue = up;
      } else {
        return err(`Unsupported field: ${field}.`);
      }

      // updateTicketField writes its own audit entry and runs the state-machine/SLA/notifications.
      await updateTicketField(toFormData({ id: ticket.id, field: realField, value: realValue }));
      const after = (await db.ticket.findUnique({ where: { id: ticket.id } })) as Record<string, unknown> | null;
      return verifyFieldWrite(after?.[realField], realValue, `Updated ${field} on ${ticketRef(ticket.id, ticket.type)}`);
    },
  },
  {
    id: "ticket.comment",
    group: "Tickets",
    kind: "write",
    minRole: "AGENT",
    description:
      "Add a comment to a ticket. Set internal=true for an agents-only note (not visible to the requester); otherwise it's a public reply that emails the requester.",
    input: z.object({
      ref: z.string().describe("ticket ref or number"),
      text: z.string().min(1).describe("the comment content"),
      internal: z.boolean().optional().describe("true = internal note"),
      attachFiles: z
        .boolean()
        .optional()
        .describe(
          "Whether to attach the file(s) the user added to THIS chat turn to the ticket. Defaults to true. Set false only if their attachment isn't relevant.",
        ),
      attachmentIds: z
        .array(z.string())
        .optional()
        .describe("System-managed — leave unset; the server fills this with the turn's staged file ids."),
    }),
    label: (a) => `Comment on ${a.ref}`,
    run: async (a, ctx) => {
      const ticket = await resolveTicket(a.ref);
      if (!ticket) return err(`Ticket not found: ${a.ref}`);
      const text = str(a.text);
      if (!text) return err("Comment text is required.");
      const internal = a.internal === true;
      await addTicketComment(
        // Render the model's markdown to HTML so paragraphs / line breaks / lists
        // survive (the comment field stores & renders `bodyHtml`).
        toFormData({ ticketId: ticket.id, bodyHtml: richHtml(text) ?? text, isInternal: internal }),
      );
      // Attach the turn's staged files to the ticket (see ticket.create).
      if (a.attachFiles !== false && Array.isArray(a.attachmentIds) && a.attachmentIds.length) {
        await linkStagedAttachments(ctx.userId, ticket.id, a.attachmentIds.map(String));
      }
      return ok(`Added ${internal ? "an internal note" : "a comment"} to ${ticketRef(ticket.id, ticket.type)}`);
    },
  },
  {
    id: "ticket.resolve",
    group: "Tickets",
    kind: "write",
    minRole: "AGENT",
    description:
      "Resolve, close or cancel a ticket, optionally with a resolution code and a note. Stops the SLA clock and notifies the requester on resolve.",
    input: z.object({
      ref: z.string().describe("ticket ref or number"),
      status: z.enum(["RESOLVED", "CLOSED", "CANCELLED"]),
      code: z.enum(RESOLUTION_CODES).optional().describe("resolution code"),
      note: z.string().optional().describe("resolution note"),
      internal: z.boolean().optional().describe("true = keep the note internal"),
    }),
    label: (a) => `${String(a.status ?? "").toLowerCase() || "resolve"} ${a.ref}`,
    run: async (a) => {
      const ticket = await resolveTicket(a.ref);
      if (!ticket) return err(`Ticket not found: ${a.ref}`);
      const status = coerceEnum(a.status, ["RESOLVED", "CLOSED", "CANCELLED"]);
      if (!status) return err("Status must be RESOLVED, CLOSED or CANCELLED.");
      const code = str(a.code) ? coerceEnum(a.code, RESOLUTION_CODES) : null;
      if (str(a.code) && !code) return err(`Invalid resolution code "${a.code}".`);
      await setTicketResolution(
        toFormData({
          id: ticket.id,
          status,
          code: code ?? undefined,
          note: str(a.note),
          isInternal: a.internal === true,
        }),
      );
      const after = await db.ticket.findUnique({ where: { id: ticket.id }, select: { status: true } });
      return verifyFieldWrite(after?.status, status, `Set ${ticketRef(ticket.id, ticket.type)} to ${status}`);
    },
  },
  {
    id: "ticket.escalate",
    group: "Tickets",
    kind: "write",
    minRole: "AGENT",
    description: "Escalate a ticket — bumps its priority one level and notifies the assignee and watchers.",
    input: z.object({ ref: z.string().describe("ticket ref or number") }),
    label: (a) => `Escalate ${a.ref}`,
    run: async (a) => {
      const ticket = await resolveTicket(a.ref);
      if (!ticket) return err(`Ticket not found: ${a.ref}`);
      const res = await escalateTicket(toFormData({ id: ticket.id }));
      if (res && !res.ok) return err(res.error ?? "Could not escalate.");
      return ok(`Escalated ${ticketRef(ticket.id, ticket.type)}`);
    },
  },
  {
    id: "ticket.link",
    group: "Tickets",
    kind: "write",
    minRole: "AGENT",
    description:
      "Link a ticket to another ticket (e.g. a duplicate, related, blocking or causal relationship). Give the target ref or number.",
    input: z.object({
      ref: z.string().describe("source ticket ref or number"),
      target: z.string().describe("target ticket ref or number"),
      relation: z.enum(["RELATED", "DUPLICATE", "BLOCKS", "CAUSED_BY"]).optional(),
    }),
    label: (a) => `Link ${a.ref} → ${a.target}`,
    run: async (a) => {
      const ticket = await resolveTicket(a.ref);
      if (!ticket) return err(`Ticket not found: ${a.ref}`);
      const target = await resolveTicket(a.target);
      if (!target) return err(`Target ticket not found: ${a.target}`);
      if (target.id === ticket.id) return err("A ticket cannot be linked to itself.");
      const relation = coerceEnum(a.relation, ["RELATED", "DUPLICATE", "BLOCKS", "CAUSED_BY"]) ?? "RELATED";
      await linkTicket(toFormData({ id: ticket.id, targetId: target.id, type: relation }));
      return ok(`Linked ${ticketRef(ticket.id, ticket.type)} to ${ticketRef(target.id, target.type)} (${relation})`);
    },
  },
  {
    id: "ticket.add_task",
    group: "Tickets",
    kind: "write",
    minRole: "AGENT",
    description: "Add a checklist task/sub-item to a ticket.",
    input: z.object({
      ref: z.string().describe("ticket ref or number"),
      title: z.string().min(1).describe("task title"),
    }),
    label: (a) => `Add task “${a.title}” to ${a.ref}`,
    run: async (a) => {
      const ticket = await resolveTicket(a.ref);
      if (!ticket) return err(`Ticket not found: ${a.ref}`);
      const title = str(a.title);
      if (!title) return err("Task title is required.");
      await addTask(toFormData({ ticketId: ticket.id, title }));
      return ok(`Added task "${title}" to ${ticketRef(ticket.id, ticket.type)}`);
    },
  },
  {
    id: "ticket.log_work",
    group: "Tickets",
    kind: "write",
    minRole: "AGENT",
    description: "Log time spent on a ticket (in minutes), with an optional note. Mark billable=true to bill it.",
    input: z.object({
      ref: z.string().describe("ticket ref or number"),
      minutes: z.number().int().positive().describe("minutes worked"),
      note: z.string().optional(),
      billable: z.boolean().optional(),
    }),
    label: (a) => `Log ${a.minutes} min on ${a.ref}`,
    run: async (a) => {
      const ticket = await resolveTicket(a.ref);
      if (!ticket) return err(`Ticket not found: ${a.ref}`);
      const minutes = Math.floor(Number(a.minutes));
      if (!Number.isFinite(minutes) || minutes <= 0) return err("Enter a valid number of minutes.");
      const res = await addWorkLog(
        toFormData({ ticketId: ticket.id, minutes, note: str(a.note), billable: a.billable === true }),
      );
      if (res && "error" in res && res.error) return err(res.error);
      return ok(`Logged ${minutes} min on ${ticketRef(ticket.id, ticket.type)}`);
    },
  },
  {
    id: "ticket.watch",
    group: "Tickets",
    kind: "write",
    minRole: "AGENT",
    description:
      "Add or remove YOURSELF as a watcher on a ticket (watchers get its notifications). Set watch=false to stop watching.",
    input: z.object({
      ref: z.string().describe("ticket ref or number"),
      watch: z.boolean().optional().describe("true = watch (default), false = stop watching"),
    }),
    label: (a) => `${a.watch === false ? "Stop watching" : "Watch"} ${a.ref}`,
    run: async (a, ctx) => {
      const ticket = await resolveTicket(a.ref);
      if (!ticket) return err(`Ticket not found: ${a.ref}`);
      const want = a.watch !== false;
      const existing = await db.ticketWatcher.findUnique({
        where: { ticketId_userId: { ticketId: ticket.id, userId: ctx.userId } },
        select: { ticketId: true },
      });
      if (Boolean(existing) === want) {
        return ok(`You are already ${want ? "watching" : "not watching"} ${ticketRef(ticket.id, ticket.type)}`);
      }
      // toggleWatch flips the acting user's watch state — safe because we only
      // call it when the current state differs from what's wanted.
      const res = await toggleWatch(toFormData({ id: ticket.id }));
      if (res && !res.ok) return err(res.error ?? "Could not update watch.");
      return ok(`${want ? "Now watching" : "Stopped watching"} ${ticketRef(ticket.id, ticket.type)}`);
    },
  },
  {
    id: "ticket.major_incident",
    group: "Tickets",
    kind: "write",
    minRole: "AGENT",
    description:
      "Declare or clear a ticket as a Major Incident (declaring also raises priority to CRITICAL and notifies watchers). Set on=false to clear.",
    input: z.object({
      ref: z.string().describe("ticket ref or number"),
      on: z.boolean().optional().describe("true = declare (default), false = clear"),
    }),
    label: (a) => `${a.on === false ? "Clear" : "Declare"} major incident on ${a.ref}`,
    run: async (a) => {
      const id = parseTicketId(String(a.ref ?? ""));
      const t = id
        ? await db.ticket.findUnique({ where: { id }, select: { id: true, type: true, isMajorIncident: true } })
        : null;
      if (!t) return err(`Ticket not found: ${a.ref}`);
      const want = a.on !== false;
      if (t.isMajorIncident === want) {
        return ok(`${ticketRef(t.id, t.type)} is already ${want ? "a major incident" : "not a major incident"}`);
      }
      await toggleMajorIncident(toFormData({ id: t.id }));
      return ok(`${want ? "Declared" : "Cleared"} major incident on ${ticketRef(t.id, t.type)}`);
    },
  },
];
