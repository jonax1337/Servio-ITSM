"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser, isAgent, type Role, requireAgentUser } from "@/lib/session";
import { writeAudit, notify } from "@/lib/audit";
import { readRichBody, readRichField } from "@/lib/markdown";
import { canTransitionConfigured } from "@/lib/workflow";
import { isGroupMember } from "@/lib/assignment";
import { assertRequiredCustomFields, entityFieldValues, type CustomFieldDef } from "@/lib/custom-fields";
import {
  PROBLEM_STATUSES,
  PRIORITIES,
  IMPACT_URGENCY,
} from "@/lib/constants";

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" && v !== "" ? v : null));

const createSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
  description: z.string().default(""),
  status: z.enum(PROBLEM_STATUSES).default("NEW"),
  priority: z.enum(PRIORITIES),
  impact: z.enum(IMPACT_URGENCY),
  assigneeId: optionalId,
  groupId: optionalId,
  categoryId: optionalId,
});

export type ActionState = { error?: string; fieldErrors?: Record<string, string[]> } | undefined;

export async function createProblem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await getSessionUser();
  if (!me || !isAgent(me.role as Role)) return { error: "Not authorised" };

  const raw = Object.fromEntries(formData) as Record<string, unknown>;
  // Custom-field inputs post as `cf_<key>` — collect them into the create data.
  const customFields: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("cf_") && typeof v === "string") customFields[k.slice(3)] = v;
  }
  if (Object.keys(customFields).length) raw.customFields = customFields;

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  // Enforce required, currently-visible custom fields (same contract as tickets):
  // abort the create when a required field is missing rather than persisting an
  // incomplete record.
  const defs = await db.customFieldDef.findMany({ where: { entityType: "PROBLEM", active: true } });
  if (defs.length > 0) {
    const res = assertRequiredCustomFields(defs as CustomFieldDef[], customFields, entityFieldValues({ status: data.status, priority: data.priority, categoryId: data.categoryId }));
    if (!res.ok) return { error: res.error };
  }

  const problem = await db.problem.create({
    data: { ...data, ...(Object.keys(customFields).length ? { customFields: JSON.stringify(customFields) } : {}) },
  });

  await writeAudit({ userId: me.id, action: "CREATE", entity: "Problem", entityId: problem.id, summary: `Created problem "${problem.title}"` });
  if (data.assigneeId && data.assigneeId !== me.id) {
    await notify(data.assigneeId, { type: "ASSIGNED", title: "Problem assigned to you", body: problem.title, entity: "Problem", entityId: String(problem.id) });
  }

  revalidatePath("/problems");
  redirect(`/problems/${problem.id}`);
}

const updateSchema = z.object({
  id: z.coerce.number(),
  field: z.enum([
    "status", "priority", "impact",
    "assigneeId", "groupId", "categoryId",
  ]),
  value: z.string(),
});

export async function updateProblemField(formData: FormData) {
  const me = await getSessionUser();
  if (!me || !isAgent(me.role as Role)) return;
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { id, field, value } = parsed.data;

  const isRelation = field.endsWith("Id");
  const v = isRelation && (value === "none" || value === "") ? null : value;

  const patch: Record<string, unknown> = { [field]: v };
  if (field === "status") {
    const current = await db.problem.findUnique({ where: { id }, select: { status: true } });
    if (!current) return;
    // Enforce the configured lifecycle (built-in map + admin overrides + role).
    if (!(await canTransitionConfigured("PROBLEM", current.status, value, me.role as Role))) return;
    if (value === "RESOLVED" || value === "CLOSED") patch.resolvedAt = new Date();
    if (value === "NEW" || value === "INVESTIGATING" || value === "KNOWN_ERROR") patch.resolvedAt = null;
  }
  // The assignee must belong to the problem's group (anyone when there's none).
  if (field === "assigneeId" && v) {
    const cur = await db.problem.findUnique({ where: { id }, select: { groupId: true } });
    if (cur?.groupId && !(await isGroupMember(cur.groupId, v))) return;
  }
  if (field === "groupId" && v) {
    const cur = await db.problem.findUnique({ where: { id }, select: { assigneeId: true } });
    if (cur?.assigneeId && !(await isGroupMember(v, cur.assigneeId))) patch.assigneeId = null;
  }

  await db.problem.update({ where: { id }, data: patch });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Problem", entityId: id, summary: `Updated ${field}` });
  revalidatePath(`/problems/${id}`);
  revalidatePath("/problems");
}

// ── Comments & edit ──────────────────────────────────────────────────────────

async function requireAgentP() {
  // DB-truth guard (role + isActive rehydrated) — see requireAgentUser.
  return requireAgentUser();
}

export async function addProblemComment(formData: FormData) {
  const me = await requireAgentP();
  if (!me) return;
  const id = Number(formData.get("problemId"));
  const isInternal = formData.get("isInternal") === "on";
  const { body, bodyHtml } = readRichBody(formData);
  if (!id || !body) return;
  await db.problemComment.create({ data: { problemId: id, authorId: me.id, body, bodyHtml, isInternal } });
  await db.problem.update({ where: { id }, data: { updatedAt: new Date() } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Problem", entityId: id, summary: "Added a comment" });
  revalidatePath(`/problems/${id}`);
}

export async function updateProblemDetails(formData: FormData) {
  const me = await requireAgentP();
  if (!me) return;
  const id = Number(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim();
  if (!id || title.length < 3) return;
  const { text: description, html: descriptionHtml } = readRichField(formData, "descriptionHtml", "description");
  await db.problem.update({ where: { id }, data: { title, description, descriptionHtml } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Problem", entityId: id, summary: "Edited details" });
  revalidatePath(`/problems/${id}`);
  revalidatePath("/problems");
}

// ── Investigation fields (root cause, workaround) ────────────────────────────
// Plain-text analysis fields that can be filled in / amended at any time as the
// investigation progresses. Keyed by field name via EditableTextCard.

const TEXT_FIELDS = ["rootCause", "workaround"] as const;
const textSchema = z.object({
  id: z.coerce.number(),
  field: z.enum(TEXT_FIELDS),
  value: z.string(),
});

const TEXT_LABELS: Record<(typeof TEXT_FIELDS)[number], string> = {
  rootCause: "root cause",
  workaround: "workaround",
};

export async function updateProblemText(formData: FormData) {
  const me = await requireAgentP();
  if (!me) return;
  const parsed = textSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { id, field } = parsed.data;
  const value = parsed.data.value.trim() || null;
  await db.problem.update({ where: { id }, data: { [field]: value } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Problem", entityId: id, summary: `Updated ${TEXT_LABELS[field]}` });
  revalidatePath(`/problems/${id}`);
}
