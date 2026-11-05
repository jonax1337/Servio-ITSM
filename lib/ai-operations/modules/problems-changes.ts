import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateProblemField, updateProblemText, addProblemComment } from "@/lib/actions/problems";
import { updateChangeField, addChangeComment, setChangeProblem } from "@/lib/actions/changes";
import { setTicketProblem, setTicketChange } from "@/lib/actions/tickets";
import {
  resolveGroupId,
  resolveCategoryId,
  resolveAgentId,
  categoryNotFoundHint,
  groupNotFoundHint,
} from "@/lib/ai-tools";
import {
  PRIORITIES,
  IMPACT_URGENCY,
  PROBLEM_STATUSES,
  CHANGE_TYPES,
  CHANGE_STATUSES,
  CHANGE_OUTCOMES,
  RISKS,
  problemRef,
  changeRef,
  ticketRef,
  type ArticleLinkEntityType,
} from "@/lib/constants";
import type { AiOperation, AiOpResult } from "../types";
import {
  ok,
  err,
  str,
  toFormData,
  coerceEnum,
  richHtml,
  verifyFieldWrite,
  fromActionResult,
  parseRecordNumber,
  clip,
} from "../helpers";

/**
 * Problems & Changes. Exports `OPERATIONS: AiOperation[]`, one entry per capability.
 * Creates are guarded Prisma writes + writeAudit (mirroring the real actions, minus
 * their redirects). Field updates and comments reuse the real (non-redirecting)
 * actions from `@/lib/actions/{problems,changes}` via toFormData, so their own
 * validation, audit trail, notifications and revalidation run exactly as from the UI.
 */

/** Parse a ref ("PRB-12" / "CHG-7" / "12") to its trailing integer id, or null. */
function parseRefId(ref: unknown): number | null {
  const m = String(ref ?? "").match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

const TICKET_REF_PREFIXES = ["INC", "REQ"] as const;
const dateTime = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : null);
const ticketLinks = (rows: { id: number; prefix: string; title: string; status: string }[]) =>
  rows.map((t) => ({ ref: ticketRef(t.id, t.prefix), title: t.title, status: t.status }));

type LinkTarget = { name: "problem" | "change"; prefix: string; field: "problemId" | "changeId" };
const PROBLEM_LINK: LinkTarget = { name: "problem", prefix: "PRB", field: "problemId" };
const CHANGE_LINK: LinkTarget = { name: "change", prefix: "CHG", field: "changeId" };

/** A link target ref as an id, `null` for "none" (unlink), or `undefined` when it is neither. */
function parseLinkTarget(target: unknown, link: LinkTarget): number | null | undefined {
  const raw = str(target)?.toLowerCase() ?? "";
  if (raw === "none") return null;
  return parseRecordNumber(raw, [link.prefix]) ?? undefined;
}

const unparsableTarget = (link: LinkTarget, target: unknown) =>
  err(`Cannot parse a ${link.name} ref (${link.prefix}-0019) from "${target}", or use "none" to unlink.`);

/** The knowledge articles attached to a problem or change, for the read tools. */
async function linkedArticles(entityType: ArticleLinkEntityType, entityId: number) {
  const links = await db.articleLink.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { article: { select: { title: true, slug: true, status: true } } },
  });
  return links.map((l) => l.article);
}

async function resolveChangeId(ref: unknown): Promise<{ id: number } | { error: string }> {
  const id = parseRecordNumber(ref, [CHANGE_LINK.prefix]);
  if (!id) return { error: `Cannot parse a change number from "${ref}".` };
  const change = await db.change.findUnique({ where: { id }, select: { id: true } });
  return change ?? { error: `Change not found: ${ref}` };
}

/**
 * Link (or, with target "none", unlink) a ticket and a problem/change through the
 * same server action the ticket page uses. That action returns silently when it
 * refuses (role, missing target), so the stored relation is read back and checked.
 */
async function setTicketLink(a: Record<string, unknown>, link: LinkTarget): Promise<AiOpResult> {
  const ticketId = parseRecordNumber(a.ref, TICKET_REF_PREFIXES);
  if (!ticketId) return err(`Cannot parse a ticket ref (INC-0042 / REQ-0042) from "${a.ref}".`);
  const ticket = await db.ticket.findUnique({ where: { id: ticketId }, select: { id: true, prefix: true } });
  if (!ticket) return err(`Ticket not found: ${a.ref}`);

  const targetId = parseLinkTarget(a.target, link);
  if (targetId === undefined) return unparsableTarget(link, a.target);
  const unlink = targetId === null;
  if (!unlink) {
    const lookup = { where: { id: targetId }, select: { id: true } };
    const found = link.name === "problem" ? await db.problem.findUnique(lookup) : await db.change.findUnique(lookup);
    if (!found) return err(`${link.name === "problem" ? "Problem" : "Change"} not found: ${a.target}`);
  }

  const act = link.name === "problem" ? setTicketProblem : setTicketChange;
  await act(toFormData({ ticketId: ticket.id, [link.field]: unlink ? "none" : targetId }));

  const after = await db.ticket.findUnique({ where: { id: ticket.id }, select: { problemId: true, changeId: true } });
  const ref = ticketRef(ticket.id, ticket.prefix);
  const targetRef = link.name === "problem" ? problemRef : changeRef;
  return verifyFieldWrite(
    after?.[link.field],
    unlink ? "none" : String(targetId),
    unlink ? `Unlinked ${ref} from its ${link.name}` : `Linked ${ref} to ${targetRef(targetId)}`,
  );
}

/** A write op that sets one of a problem's analysis texts through the same action the problem page uses. */
function problemTextOp(field: "rootCause" | "workaround", id: string, name: string, about: string): AiOperation {
  return {
    id,
    group: "Problems",
    kind: "write",
    minRole: "AGENT",
    description:
      `Record the ${name} of a Problem (replaces the current text). A known error needs a workaround and a resolved problem needs a root cause, ` +
      "so document them here before moving the problem on. Closed problems are read-only.",
    input: z.object({
      ref: z.string().describe("problem ref, e.g. 'PRB-0019'"),
      text: z.string().min(1).describe(about),
    }),
    label: (a) => `Set ${name} of ${a.ref}`,
    run: async (a) => {
      const problemId = parseRecordNumber(a.ref, [PROBLEM_LINK.prefix]);
      if (!problemId) return err(`Cannot parse a problem number from "${a.ref}".`);
      const text = str(a.text);
      if (!text) return err(`The ${name} text is required.`);
      const res = await updateProblemText(toFormData({ id: problemId, field, value: text }));
      return fromActionResult(res, `Updated the ${name} of ${problemRef(problemId)}`);
    },
  };
}

export const OPERATIONS: AiOperation[] = [
  {
    id: "problem.create",
    group: "Problems",
    kind: "write",
    minRole: "AGENT",
    description:
      "Create a new Problem (root-cause investigation / known error). Optionally set priority, impact, and a team, category and assignee by name. Starts in status NEW.",
    input: z.object({
      title: z.string().min(3).describe("problem title"),
      description: z.string().optional(),
      priority: z.enum(PRIORITIES).optional(),
      impact: z.enum(IMPACT_URGENCY).optional().describe("business impact: LOW, MEDIUM or HIGH"),
      team: z.string().optional().describe("team/group name to own it"),
      category: z.string().optional().describe("category name"),
      assignee: z.string().optional().describe("assignee name or email"),
    }),
    label: (a) => `Create problem “${a.title}”`,
    run: async (a, ctx) => {
      const title = str(a.title);
      if (!title || title.length < 3) return err("Problem title is too short.");

      const priority = (coerceEnum(a.priority, PRIORITIES) ?? "MEDIUM") as (typeof PRIORITIES)[number];
      const impact = (coerceEnum(a.impact, IMPACT_URGENCY) ?? "MEDIUM") as (typeof IMPACT_URGENCY)[number];

      const teamName = str(a.team);
      const team = teamName ? await resolveGroupId(teamName) : null;
      if (teamName && !team) return err(`Team not found: ${a.team}.${await groupNotFoundHint(teamName)}`);

      const categoryName = str(a.category);
      const category = categoryName ? await resolveCategoryId(categoryName) : null;
      if (categoryName && !category)
        return err(`Category not found: ${a.category}.${await categoryNotFoundHint(categoryName)}`);

      const assigneeName = str(a.assignee);
      const assignee = assigneeName ? await resolveAgentId(assigneeName) : null;
      if (assigneeName && !assignee) return err(`Agent not found: ${a.assignee}`);

      const p = await db.problem.create({
        data: {
          title,
          description: str(a.description) ?? "",
          descriptionHtml: richHtml(a.description),
          status: "NEW",
          priority,
          impact,
          ...(team ? { groupId: team.id } : {}),
          ...(category ? { categoryId: category.id } : {}),
          ...(assignee ? { assigneeId: assignee.id } : {}),
        },
      });
      await writeAudit({
        userId: ctx.userId,
        action: "CREATE",
        entity: "Problem",
        entityId: p.id,
        summary: `Created problem "${title}"`,
      });
      return ok(`Created ${problemRef(p.id)} — "${title}"`);
    },
  },
  {
    id: "problem.update_field",
    group: "Problems",
    kind: "write",
    minRole: "AGENT",
    description:
      "Change one field on a Problem. Field is one of: status, priority, impact, team, category, assignee. " +
      "Use a human value/name (e.g. status 'KNOWN_ERROR', team 'Infrastructure', assignee 'Nora K').",
    input: z.object({
      ref: z.string().describe("problem ref or number, e.g. 'PRB-12' or '12'"),
      field: z.enum(["status", "priority", "impact", "team", "category", "assignee"]),
      value: z.string().describe("target value or name"),
    }),
    label: (a) => `Set ${a.field} = “${a.value}” on ${a.ref}`,
    run: async (a) => {
      const id = parseRefId(a.ref);
      if (!id) return err(`Cannot parse a problem number from "${a.ref}".`);
      const problem = await db.problem.findUnique({ where: { id: Number(id) }, select: { id: true } });
      if (!problem) return err(`Problem not found: ${a.ref}`);

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
      } else if (field === "status") {
        const up = coerceEnum(value, PROBLEM_STATUSES);
        if (!up) return err(`Invalid status "${value}". Allowed: ${PROBLEM_STATUSES.join(", ")}.`);
        realValue = up;
      } else if (field === "priority") {
        const up = coerceEnum(value, PRIORITIES);
        if (!up) return err(`Invalid priority "${value}". Allowed: ${PRIORITIES.join(", ")}.`);
        realValue = up;
      } else if (field === "impact") {
        const up = coerceEnum(value, IMPACT_URGENCY);
        if (!up) return err(`Invalid impact "${value}". Allowed: ${IMPACT_URGENCY.join(", ")}.`);
        realValue = up;
      } else {
        return err(`Unsupported field: ${field}.`);
      }

      // updateProblemField re-validates, writes its own audit entry and revalidates.
      const res = await updateProblemField(toFormData({ id: problem.id, field: realField, value: realValue }));
      if (!res.ok) return err(res.error);
      const after = (await db.problem.findUnique({ where: { id: problem.id } })) as Record<string, unknown> | null;
      return verifyFieldWrite(after?.[realField], realValue, `Updated ${field} on ${problemRef(problem.id)}`);
    },
  },
  {
    id: "problem.comment",
    group: "Problems",
    kind: "write",
    minRole: "AGENT",
    description:
      "Add a comment to a Problem. Set internal=true for an agents-only note; otherwise it's a public comment.",
    input: z.object({
      ref: z.string().describe("problem ref or number"),
      text: z.string().min(1).describe("the comment content"),
      internal: z.boolean().optional().describe("true = internal note"),
    }),
    label: (a) => `Comment on ${a.ref}`,
    run: async (a) => {
      const id = parseRefId(a.ref);
      if (!id) return err(`Cannot parse a problem number from "${a.ref}".`);
      const problem = await db.problem.findUnique({ where: { id: Number(id) }, select: { id: true } });
      if (!problem) return err(`Problem not found: ${a.ref}`);
      const text = str(a.text);
      if (!text) return err("Comment text is required.");
      const internal = a.internal === true;
      await addProblemComment(
        toFormData({ problemId: problem.id, bodyHtml: richHtml(text) ?? text, isInternal: internal ? "on" : "" }),
      );
      return ok(`Added ${internal ? "an internal note" : "a comment"} to ${problemRef(problem.id)}`);
    },
  },
  {
    id: "change.create",
    group: "Changes",
    kind: "write",
    minRole: "AGENT",
    description:
      "Create a new Change record (planned change / maintenance). Optionally set type, risk, priority, impact, and a team, category and assignee by name. Starts as a DRAFT.",
    input: z.object({
      title: z.string().min(3).describe("change title"),
      description: z.string().optional(),
      type: z.enum(CHANGE_TYPES).optional().describe("STANDARD, NORMAL or EMERGENCY"),
      risk: z.enum(RISKS).optional().describe("LOW, MEDIUM or HIGH"),
      priority: z.enum(PRIORITIES).optional(),
      impact: z.enum(IMPACT_URGENCY).optional().describe("LOW, MEDIUM or HIGH"),
      team: z.string().optional().describe("team/group name to own it"),
      category: z.string().optional().describe("category name"),
      assignee: z.string().optional().describe("assignee name or email"),
    }),
    label: (a) => `Create change “${a.title}”`,
    run: async (a, ctx) => {
      const title = str(a.title);
      if (!title || title.length < 3) return err("Change title is too short.");

      const type = (coerceEnum(a.type, CHANGE_TYPES) ?? "NORMAL") as (typeof CHANGE_TYPES)[number];
      const risk = (coerceEnum(a.risk, RISKS) ?? "MEDIUM") as (typeof RISKS)[number];
      const priority = (coerceEnum(a.priority, PRIORITIES) ?? "MEDIUM") as (typeof PRIORITIES)[number];
      const impact = (coerceEnum(a.impact, IMPACT_URGENCY) ?? "MEDIUM") as (typeof IMPACT_URGENCY)[number];

      const teamName = str(a.team);
      const team = teamName ? await resolveGroupId(teamName) : null;
      if (teamName && !team) return err(`Team not found: ${a.team}.${await groupNotFoundHint(teamName)}`);

      const categoryName = str(a.category);
      const category = categoryName ? await resolveCategoryId(categoryName) : null;
      if (categoryName && !category)
        return err(`Category not found: ${a.category}.${await categoryNotFoundHint(categoryName)}`);

      const assigneeName = str(a.assignee);
      const assignee = assigneeName ? await resolveAgentId(assigneeName) : null;
      if (assigneeName && !assignee) return err(`Agent not found: ${a.assignee}`);

      const c = await db.change.create({
        data: {
          title,
          description: str(a.description) ?? "",
          descriptionHtml: richHtml(a.description),
          type,
          risk,
          priority,
          impact,
          status: "DRAFT",
          ...(team ? { groupId: team.id } : {}),
          ...(category ? { categoryId: category.id } : {}),
          ...(assignee ? { assigneeId: assignee.id } : {}),
        },
      });
      await writeAudit({
        userId: ctx.userId,
        action: "CREATE",
        entity: "Change",
        entityId: c.id,
        summary: `Created change "${title}"`,
      });
      return ok(`Created ${changeRef(c.id)} — "${title}"`);
    },
  },
  {
    id: "change.update_field",
    group: "Changes",
    kind: "write",
    minRole: "AGENT",
    description:
      "Change one field on a Change. Field is one of: status, type, risk, priority, impact, team, category, assignee. " +
      "Use a human value/name (e.g. status 'SCHEDULED', type 'EMERGENCY', team 'Infrastructure', assignee 'Nora K'). " +
      "To close a change use change.close (outcome and closure notes are required); to cancel one use change.cancel (a reason is required).",
    input: z.object({
      ref: z.string().describe("change ref or number, e.g. 'CHG-7' or '7'"),
      field: z.enum(["status", "type", "risk", "priority", "impact", "team", "category", "assignee"]),
      value: z.string().describe("target value or name"),
    }),
    label: (a) => `Set ${a.field} = “${a.value}” on ${a.ref}`,
    run: async (a) => {
      const id = parseRefId(a.ref);
      if (!id) return err(`Cannot parse a change number from "${a.ref}".`);
      const change = await db.change.findUnique({ where: { id: Number(id) }, select: { id: true } });
      if (!change) return err(`Change not found: ${a.ref}`);

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
      } else if (field === "status") {
        const up = coerceEnum(value, CHANGE_STATUSES);
        if (!up) return err(`Invalid status "${value}". Allowed: ${CHANGE_STATUSES.join(", ")}.`);
        realValue = up;
      } else if (field === "type") {
        const up = coerceEnum(value, CHANGE_TYPES);
        if (!up) return err(`Invalid type "${value}". Allowed: ${CHANGE_TYPES.join(", ")}.`);
        realValue = up;
      } else if (field === "risk") {
        const up = coerceEnum(value, RISKS);
        if (!up) return err(`Invalid risk "${value}". Allowed: ${RISKS.join(", ")}.`);
        realValue = up;
      } else if (field === "priority") {
        const up = coerceEnum(value, PRIORITIES);
        if (!up) return err(`Invalid priority "${value}". Allowed: ${PRIORITIES.join(", ")}.`);
        realValue = up;
      } else if (field === "impact") {
        const up = coerceEnum(value, IMPACT_URGENCY);
        if (!up) return err(`Invalid impact "${value}". Allowed: ${IMPACT_URGENCY.join(", ")}.`);
        realValue = up;
      } else {
        return err(`Unsupported field: ${field}.`);
      }

      // updateChangeField re-validates, writes its own audit entry and revalidates.
      const res = await updateChangeField(toFormData({ id: change.id, field: realField, value: realValue }));
      if (!res.ok) return err(res.error);
      const after = (await db.change.findUnique({ where: { id: change.id } })) as Record<string, unknown> | null;
      return verifyFieldWrite(after?.[realField], realValue, `Updated ${field} on ${changeRef(change.id)}`);
    },
  },
  {
    id: "change.comment",
    group: "Changes",
    kind: "write",
    minRole: "AGENT",
    description:
      "Add a comment to a Change. Set internal=true for an agents-only note; otherwise it's a public comment.",
    input: z.object({
      ref: z.string().describe("change ref or number"),
      text: z.string().min(1).describe("the comment content"),
      internal: z.boolean().optional().describe("true = internal note"),
    }),
    label: (a) => `Comment on ${a.ref}`,
    run: async (a) => {
      const id = parseRefId(a.ref);
      if (!id) return err(`Cannot parse a change number from "${a.ref}".`);
      const change = await db.change.findUnique({ where: { id: Number(id) }, select: { id: true } });
      if (!change) return err(`Change not found: ${a.ref}`);
      const text = str(a.text);
      if (!text) return err("Comment text is required.");
      const internal = a.internal === true;
      await addChangeComment(
        toFormData({ changeId: change.id, bodyHtml: richHtml(text) ?? text, isInternal: internal ? "on" : "" }),
      );
      return ok(`Added ${internal ? "an internal note" : "a comment"} to ${changeRef(change.id)}`);
    },
  },
  {
    id: "change.set_problem",
    group: "Changes",
    kind: "write",
    minRole: "AGENT",
    description:
      "Link a Change to the Problem it fixes, or unlink it. Pass the change ref and the problem ref; " +
      "use target 'none' to remove the change's current problem link. A change has at most one problem.",
    input: z.object({
      ref: z.string().describe("change ref, e.g. 'CHG-0025'"),
      target: z.string().describe("problem ref, e.g. 'PRB-0019', or 'none' to unlink"),
    }),
    label: (a) => (str(a.target)?.toLowerCase() === "none" ? `Unlink ${a.ref} from its problem` : `Link ${a.ref} → ${a.target}`),
    run: async (a) => {
      const change = await resolveChangeId(a.ref);
      if ("error" in change) return err(change.error);
      const problemId = parseLinkTarget(a.target, PROBLEM_LINK);
      if (problemId === undefined) return unparsableTarget(PROBLEM_LINK, a.target);
      const res = await setChangeProblem(change.id, problemId);
      return fromActionResult(
        res,
        problemId === null
          ? `Unlinked ${changeRef(change.id)} from its problem`
          : `Linked ${changeRef(change.id)} to ${problemRef(problemId)}`,
      );
    },
  },
  {
    id: "change.close",
    group: "Changes",
    kind: "write",
    minRole: "AGENT",
    description:
      "Close a Change once it has been implemented and reviewed. Requires the outcome (SUCCESSFUL, SUCCESSFUL_WITH_ISSUES, FAILED or ROLLED_BACK) " +
      "and closure notes (the post-implementation review or lessons learned). The change must be in a status that may move to CLOSED.",
    input: z.object({
      ref: z.string().describe("change ref, e.g. 'CHG-0025'"),
      outcome: z.enum(CHANGE_OUTCOMES).describe("how the implementation went"),
      closureNotes: z.string().min(1).describe("post-implementation review / lessons learned"),
    }),
    label: (a) => `Close ${a.ref} (${a.outcome})`,
    run: async (a) => {
      const change = await resolveChangeId(a.ref);
      if ("error" in change) return err(change.error);
      const outcome = coerceEnum(a.outcome, CHANGE_OUTCOMES);
      if (!outcome) return err(`Invalid outcome "${a.outcome}". Allowed: ${CHANGE_OUTCOMES.join(", ")}.`);
      const closureNotes = str(a.closureNotes);
      if (!closureNotes) return err("Closure notes are required.");
      const res = await updateChangeField(toFormData({ id: change.id, field: "status", value: "CLOSED", outcome, closureNotes }));
      return fromActionResult(res, `Closed ${changeRef(change.id)} (outcome: ${outcome})`);
    },
  },
  {
    id: "change.cancel",
    group: "Changes",
    kind: "write",
    minRole: "AGENT",
    description:
      "Cancel a Change that will not be implemented. A reason is required. Pending approval requests are withdrawn. " +
      "A closed or already cancelled change cannot be cancelled.",
    input: z.object({
      ref: z.string().describe("change ref, e.g. 'CHG-0025'"),
      reason: z.string().min(1).describe("why the change is cancelled"),
    }),
    label: (a) => `Cancel ${a.ref}`,
    run: async (a) => {
      const change = await resolveChangeId(a.ref);
      if ("error" in change) return err(change.error);
      const cancelReason = str(a.reason);
      if (!cancelReason) return err("A reason for cancelling is required.");
      const res = await updateChangeField(toFormData({ id: change.id, field: "status", value: "CANCELLED", cancelReason }));
      return fromActionResult(res, `Cancelled ${changeRef(change.id)}`);
    },
  },
  problemTextOp("rootCause", "problem.set_root_cause", "root cause", "the analysed root cause of the problem"),
  problemTextOp("workaround", "problem.set_workaround", "workaround", "the documented workaround for the problem"),
  {
    id: "ticket.set_problem",
    group: "Problems",
    kind: "write",
    minRole: "AGENT",
    description:
      "Link a ticket (incident/request) to a Problem, or unlink it. Works from either side: pass the ticket ref and the problem ref. " +
      "Use target 'none' to remove the ticket's current problem link. A ticket has at most one problem.",
    input: z.object({
      ref: z.string().describe("ticket ref, e.g. 'INC-0157'"),
      target: z.string().describe("problem ref, e.g. 'PRB-0019', or 'none' to unlink"),
    }),
    label: (a) => (str(a.target)?.toLowerCase() === "none" ? `Unlink ${a.ref} from its problem` : `Link ${a.ref} → ${a.target}`),
    run: (a) => setTicketLink(a, PROBLEM_LINK),
  },
  {
    id: "ticket.set_change",
    group: "Changes",
    kind: "write",
    minRole: "AGENT",
    description:
      "Link a ticket (incident/request) to a Change, or unlink it. Works from either side: pass the ticket ref and the change ref. " +
      "Use target 'none' to remove the ticket's current change link. A ticket has at most one change.",
    input: z.object({
      ref: z.string().describe("ticket ref, e.g. 'INC-0157'"),
      target: z.string().describe("change ref, e.g. 'CHG-0025', or 'none' to unlink"),
    }),
    label: (a) => (str(a.target)?.toLowerCase() === "none" ? `Unlink ${a.ref} from its change` : `Link ${a.ref} → ${a.target}`),
    run: (a) => setTicketLink(a, CHANGE_LINK),
  },
  {
    id: "problem.get",
    group: "Problems",
    kind: "read",
    minRole: "AGENT",
    description:
      "Get ONE Problem in full by ref ('PRB-0019' or '19'): status, priority, impact, root cause, workaround, team, assignee, " +
      "description, linked incidents/tickets, linked knowledge articles, changes that reference it and the latest comments.",
    input: z.object({ ref: z.string().describe("problem ref or number") }),
    run: async (a) => {
      const id = parseRecordNumber(a.ref, [PROBLEM_LINK.prefix]);
      if (!id) return err(`Cannot parse a problem number from "${a.ref}".`);
      const p = await db.problem.findUnique({
        where: { id },
        include: {
          assignee: { select: { name: true } },
          group: { select: { name: true } },
          category: { select: { name: true } },
          tickets: { select: { id: true, prefix: true, title: true, status: true }, orderBy: { id: "desc" }, take: 20 },
          changes: { select: { id: true, title: true, status: true }, orderBy: { id: "desc" }, take: 10 },
          comments: {
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { body: true, isInternal: true, createdAt: true, author: { select: { name: true } } },
          },
        },
      });
      if (!p) return err(`Problem not found: ${a.ref}`);
      const articles = await linkedArticles("PROBLEM", p.id);
      return ok(`${problemRef(p.id)} — ${p.title}`, {
        ok: true,
        problem: {
          ref: problemRef(p.id),
          title: p.title,
          status: p.status,
          priority: p.priority,
          impact: p.impact,
          rootCause: clip(p.rootCause) ?? "not recorded",
          workaround: clip(p.workaround) ?? "not recorded",
          team: p.group?.name ?? null,
          category: p.category?.name ?? null,
          assignee: p.assignee?.name ?? "Unassigned",
          created: dateTime(p.createdAt),
          resolved: dateTime(p.resolvedAt),
          description: clip(p.description),
          linkedTickets: ticketLinks(p.tickets),
          linkedChanges: p.changes.map((c) => ({ ref: changeRef(c.id), title: c.title, status: c.status })),
          linkedArticles: articles,
          latestComments: p.comments.map((c) => ({
            by: c.author.name,
            internal: c.isInternal,
            at: dateTime(c.createdAt),
            text: clip(c.body, 300),
          })),
        },
      });
    },
  },
  {
    id: "change.get",
    group: "Changes",
    kind: "read",
    minRole: "AGENT",
    description:
      "Get ONE Change in full by ref ('CHG-0025' or '25'): type, risk, priority, impact, status, planned/actual start and end, " +
      "reason, implementation plan, rollback (backout) plan, CAB approval rule and each approver's decision with comment, " +
      "linked problem, tickets and knowledge articles, outcome and closure notes (or cancellation reason), assignee, team and the latest comments. Use it before reasoning about a change.",
    input: z.object({ ref: z.string().describe("change ref or number") }),
    run: async (a) => {
      const id = parseRecordNumber(a.ref, [CHANGE_LINK.prefix]);
      if (!id) return err(`Cannot parse a change number from "${a.ref}".`);
      const c = await db.change.findUnique({
        where: { id },
        include: {
          assignee: { select: { name: true } },
          createdBy: { select: { name: true } },
          group: { select: { name: true } },
          category: { select: { name: true } },
          problem: { select: { id: true, title: true, status: true } },
          approvals: {
            orderBy: { createdAt: "asc" },
            select: { status: true, comment: true, decidedAt: true, approver: { select: { name: true } } },
          },
          tickets: { select: { id: true, prefix: true, title: true, status: true }, orderBy: { id: "desc" }, take: 20 },
          comments: {
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { body: true, isInternal: true, createdAt: true, author: { select: { name: true } } },
          },
        },
      });
      if (!c) return err(`Change not found: ${a.ref}`);
      const articles = await linkedArticles("CHANGE", c.id);
      return ok(`${changeRef(c.id)} — ${c.title}`, {
        ok: true,
        change: {
          ref: changeRef(c.id),
          title: c.title,
          type: c.type,
          status: c.status,
          risk: c.risk,
          priority: c.priority,
          impact: c.impact,
          team: c.group?.name ?? null,
          category: c.category?.name ?? null,
          assignee: c.assignee?.name ?? "Unassigned",
          requestedBy: c.createdBy?.name ?? null,
          plannedStart: dateTime(c.plannedStart),
          plannedEnd: dateTime(c.plannedEnd),
          actualStart: dateTime(c.actualStart),
          actualEnd: dateTime(c.actualEnd),
          reason: clip(c.reason),
          description: clip(c.description),
          implementationPlan: clip(c.implementationPlan, 1500) ?? "not recorded",
          rollbackPlan: clip(c.rollbackPlan, 1500) ?? "not recorded",
          outcome: c.outcome,
          closureNotes: clip(c.closureNotes, 1500),
          cancelReason: clip(c.cancelReason),
          approvalRule: c.approvalThreshold ? `${c.approvalRule} (${c.approvalThreshold})` : c.approvalRule,
          approvals: c.approvals.map((x) => ({
            approver: x.approver.name,
            decision: x.status,
            comment: clip(x.comment, 300),
            decidedAt: dateTime(x.decidedAt),
          })),
          linkedProblem: c.problem ? { ref: problemRef(c.problem.id), title: c.problem.title, status: c.problem.status } : null,
          linkedTickets: ticketLinks(c.tickets),
          linkedArticles: articles,
          latestComments: c.comments.map((x) => ({
            by: x.author.name,
            internal: x.isInternal,
            at: dateTime(x.createdAt),
            text: clip(x.body, 300),
          })),
        },
      });
    },
  },
];
