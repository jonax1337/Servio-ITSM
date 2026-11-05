import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { updateProblemField, addProblemComment } from "@/lib/actions/problems";
import { updateChangeField, addChangeComment } from "@/lib/actions/changes";
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
  RISKS,
  problemRef,
  changeRef,
} from "@/lib/constants";
import type { AiOperation } from "../types";
import { ok, err, str, toFormData, coerceEnum, richHtml, verifyFieldWrite } from "../helpers";

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
      await updateProblemField(toFormData({ id: problem.id, field: realField, value: realValue }));
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
      "Change one field on a Change. Field is one of: status, type, risk, priority, team, category, assignee. " +
      "Use a human value/name (e.g. status 'SCHEDULED', type 'EMERGENCY', team 'Infrastructure', assignee 'Nora K').",
    input: z.object({
      ref: z.string().describe("change ref or number, e.g. 'CHG-7' or '7'"),
      field: z.enum(["status", "type", "risk", "priority", "team", "category", "assignee"]),
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
      } else {
        return err(`Unsupported field: ${field}.`);
      }

      // updateChangeField re-validates, writes its own audit entry and revalidates.
      await updateChangeField(toFormData({ id: change.id, field: realField, value: realValue }));
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
];
