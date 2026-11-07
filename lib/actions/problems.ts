"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser, isAgent, type Role, requireAgentUser } from "@/lib/session";
import { apiActorUserId } from "@/lib/api-actor";
import { writeAudit, notify } from "@/lib/audit";
import { readRichBody, readRichField } from "@/lib/markdown";
import { canTransitionConfigured } from "@/lib/workflow";
import { isGroupMember } from "@/lib/assignment";
import { fieldLockError, resolvedAtPatch, statusRequirementError, textEditError } from "@/lib/problem-rules";
import { assertRequiredCustomFields, entityFieldValues, isFieldVisible, validateCustomFieldValues, type CustomFieldDef } from "@/lib/custom-fields";
import { canActOnTicket } from "@/lib/authz";
import { problemTraits } from "@/lib/ai-insights-rules";
import { problemFieldsCheck } from "@/lib/ai-insights-handling";
import { linkTicketsToProblem, NONE_LINKABLE, NothingToLink } from "@/lib/problem-linking";
import { findSimilarTickets } from "@/lib/ai-similarity-search";
import {
  PROBLEM_STATUSES,
  PRIORITIES,
  IMPACT_URGENCY,
  problemRef,
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

/** Custom-field inputs post as `cf_<key>`; this collects them as key to value. */
function customFieldEntries(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("cf_") && typeof v === "string") values[k.slice(3)] = v;
  }
  return values;
}

// createdId: only for /api/v1 callers (they get the id instead of a redirect).
export type ActionState = { error?: string; fieldErrors?: Record<string, string[]>; createdId?: number } | undefined;

export async function createProblem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await getSessionUser();
  if (!me || !isAgent(me.role as Role)) return { error: "Not authorised" };

  const raw = Object.fromEntries(formData) as Record<string, unknown>;
  // Custom-field inputs post as `cf_<key>` — collect them into the create data.
  const submitted = customFieldEntries(formData);
  if (Object.keys(submitted).length) raw.customFields = submitted;

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  // A problem is born undocumented, so it cannot start in a status that requires documentation.
  const undocumented = statusRequirementError(data.status, { rootCause: null, workaround: null });
  if (undocumented) return { error: undocumented };

  // Enforce required, currently-visible custom fields (same contract as tickets):
  // abort the create when a required field is missing rather than persisting an
  // incomplete record.
  const defs = (await db.customFieldDef.findMany({ where: { entityType: "PROBLEM", active: true } })) as CustomFieldDef[];
  if (defs.length > 0) {
    const res = assertRequiredCustomFields(defs, submitted, entityFieldValues({ status: data.status, priority: data.priority, categoryId: data.categoryId }));
    if (!res.ok) return { error: res.error };
  }
  // Only the problem's own fields are stored, and each value has to be valid for its field.
  const checked = validateCustomFieldValues(defs, submitted);
  if (!checked.ok) return { error: checked.error };
  const customFields = checked.values;

  const problem = await db.problem.create({
    data: { ...data, ...resolvedAtPatch(data.status, new Date(), null), ...(Object.keys(customFields).length ? { customFields: JSON.stringify(customFields) } : {}) },
  });

  await writeAudit({ userId: me.id, action: "CREATE", entity: "Problem", entityId: problem.id, summary: `Created problem "${problem.title}"` });
  if (data.assigneeId && data.assigneeId !== me.id) {
    await notify(data.assigneeId, { type: "ASSIGNED", title: "Problem assigned to you", body: problem.title, entity: "Problem", entityId: String(problem.id) });
  }

  revalidatePath("/problems");
  if (apiActorUserId()) return { createdId: problem.id };
  redirect(`/problems/${problem.id}`);
}

const MAX_RAISED_TICKETS = 200;
const MAX_TITLE_CHARS = 160;
const SIMILAR_INCIDENT_LIMIT = 8;

const raiseSchema = z.object({
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(MAX_TITLE_CHARS),
  description: z.string().default(""),
  ticketIds: z
    .string()
    .transform((raw) => [...new Set(raw.split(",").map((id) => Number(id.trim())).filter((id) => Number.isInteger(id) && id > 0))])
    .pipe(z.array(z.number()).min(1, "Choose at least one ticket").max(MAX_RAISED_TICKETS)),
});

export type RaiseProblemResult =
  | { ok: true; problemId: number; linked: number; skipped: number }
  | { ok: false; error: string };

const RAISE_SELECT = {
  id: true, prefix: true, title: true, priority: true, impact: true, categoryId: true, groupId: true,
  assigneeId: true, problemId: true, mergedIntoId: true,
} as const;

/** The tickets among `ticketIds` that can still be linked to a new problem by `me`. */
async function linkableTickets(me: { id: string; role: string }, ticketIds: readonly number[]) {
  const tickets = await db.ticket.findMany({ where: { id: { in: [...ticketIds] } }, select: RAISE_SELECT });
  const linkable = [];
  for (const ticket of tickets) {
    if (ticket.mergedIntoId === null && ticket.problemId === null && (await canActOnTicket(me, ticket))) linkable.push(ticket);
  }
  return linkable;
}

/** The custom fields a problem raised for these tickets needs filled in: required and visible for the traits it inherits. */
export async function listRaiseProblemFields(ticketIds: number[]): Promise<CustomFieldDef[]> {
  const me = await requireAgentUser();
  if (!me || !ticketIds.every(Number.isInteger)) return [];
  const linkable = await linkableTickets(me, ticketIds.slice(0, MAX_RAISED_TICKETS));
  if (linkable.length === 0) return [];
  const { priority, categoryId } = problemTraits(linkable);
  const { defs } = await problemFieldsCheck(categoryId, priority);
  const entityValues = entityFieldValues({ status: "NEW", priority, categoryId });
  return defs.filter((def) => def.required && isFieldVisible(def, entityValues));
}

/**
 * Opens a problem for tickets (an incident, or a bulk selection) and links them in
 * one step. Tickets that already belong to a problem, are merged away or are outside
 * the agent's groups are skipped; the problem inherits priority, impact, category and
 * group from the tickets it links. Required problem custom fields arrive as `cf_<key>`.
 */
export async function createProblemFromTickets(formData: FormData): Promise<RaiseProblemResult> {
  const me = await requireAgentUser();
  if (!me) return { ok: false, error: "Not authorised" };
  const parsed = raiseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const { title, description, ticketIds } = parsed.data;

  const linkable = await linkableTickets(me, ticketIds);
  if (linkable.length === 0) return { ok: false, error: NONE_LINKABLE };

  const traits = problemTraits(linkable);
  const submitted = customFieldEntries(formData);
  const { defs, error: missingFields } = await problemFieldsCheck(traits.categoryId, traits.priority, submitted);
  if (missingFields) return { ok: false, error: missingFields };
  const checked = validateCustomFieldValues(defs, submitted);
  if (!checked.ok) return { ok: false, error: checked.error };
  const customFields = checked.values;

  const candidateIds = linkable.map((t) => t.id);
  let created: { problemId: number; linkedIds: number[] };
  try {
    created = await db.$transaction(async (tx) => {
      const problem = await tx.problem.create({
        data: {
          title, description, status: "NEW", ...traits,
          ...(Object.keys(customFields).length ? { customFields: JSON.stringify(customFields) } : {}),
        },
        select: { id: true },
      });
      return { problemId: problem.id, linkedIds: await linkTicketsToProblem(tx, problem.id, candidateIds) };
    });
  } catch (error) {
    if (error instanceof NothingToLink) return { ok: false, error: NONE_LINKABLE };
    throw error;
  }

  const { problemId, linkedIds } = created;
  await writeAudit({ userId: me.id, action: "CREATE", entity: "Problem", entityId: problemId, summary: `Created problem "${title}" from ${linkedIds.length} ticket(s)` });
  for (const id of linkedIds) {
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "Ticket", entityId: id, summary: `Linked to ${problemRef(problemId)}` });
    revalidatePath(`/tickets/${id}`);
  }
  revalidatePath("/problems");
  revalidatePath("/tickets");
  return { ok: true, problemId, linked: linkedIds.length, skipped: ticketIds.length - linkedIds.length };
}

export type SimilarIncident = { id: number; ref: string; title: string; score: number };

/** Incidents similar to `ticketId` that can still be linked to a new problem (no problem yet, within the agent's groups). */
export async function listSimilarIncidents(ticketId: number): Promise<SimilarIncident[]> {
  const me = await requireAgentUser();
  if (!me || !Number.isInteger(ticketId)) return [];
  const similar = await findSimilarTickets(ticketId, SIMILAR_INCIDENT_LIMIT);
  const candidates = await db.ticket.findMany({
    where: { id: { in: similar.map((s) => s.id) }, type: "INCIDENT", problemId: null },
    select: { id: true, assigneeId: true, groupId: true },
  });
  const linkable = new Set<number>();
  for (const candidate of candidates) if (await canActOnTicket(me, candidate)) linkable.add(candidate.id);
  return similar.filter((s) => linkable.has(s.id)).map(({ id, ref, title, score }) => ({ id, ref, title, score }));
}

const updateSchema = z.object({
  id: z.coerce.number(),
  field: z.enum([
    "status", "priority", "impact",
    "assigneeId", "groupId", "categoryId",
  ]),
  value: z.string(),
});

export type ProblemActionResult = { ok: true } | { ok: false; error: string };

const OK: ProblemActionResult = { ok: true };
const refuse = (error: string): ProblemActionResult => ({ ok: false, error });
const NOT_AUTHORISED = "Not authorised.";
const INVALID_REQUEST = "That change isn't valid for this problem.";
const NOT_FOUND = "Problem not found.";
const CHANGED_MEANWHILE = "This problem was changed by someone else. Reload and try again.";

export async function updateProblemField(formData: FormData): Promise<ProblemActionResult> {
  const me = await getSessionUser();
  if (!me || !isAgent(me.role as Role)) return refuse(NOT_AUTHORISED);
  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refuse(INVALID_REQUEST);
  const { id, field, value } = parsed.data;

  const current = await db.problem.findUnique({
    where: { id },
    select: { status: true, resolvedAt: true, rootCause: true, workaround: true, groupId: true, assigneeId: true },
  });
  if (!current) return refuse(NOT_FOUND);
  const locked = fieldLockError(current.status, field);
  if (locked) return refuse(locked);

  const isRelation = field.endsWith("Id");
  const v = isRelation && (value === "none" || value === "") ? null : value;

  const patch: Record<string, unknown> = { [field]: v };
  if (field === "status") {
    // Enforce the configured lifecycle (built-in map + admin overrides + role).
    if (!(await canTransitionConfigured("PROBLEM", current.status, value, me.role as Role))) {
      return refuse("That status change isn't allowed from the current status.");
    }
    const missing = statusRequirementError(value, current);
    if (missing) return refuse(missing);
    Object.assign(patch, resolvedAtPatch(value, new Date(), current.resolvedAt));
  }
  // The assignee must belong to the problem's group (anyone when there's none).
  if (field === "assigneeId" && v && current.groupId && !(await isGroupMember(current.groupId, v))) {
    return refuse("The assignee must be a member of the problem's group.");
  }
  if (field === "groupId" && v && current.assigneeId && !(await isGroupMember(v, current.assigneeId))) {
    patch.assigneeId = null;
  }

  // Write only if the state the checks above read is still current.
  const { count } = await db.problem.updateMany({
    where: { id, status: current.status, rootCause: current.rootCause, workaround: current.workaround },
    data: patch,
  });
  if (count === 0) return refuse(CHANGED_MEANWHILE);
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Problem", entityId: id, summary: `Updated ${field}` });
  revalidatePath(`/problems/${id}`);
  revalidatePath("/problems");
  return OK;
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

export async function updateProblemDetails(formData: FormData): Promise<ProblemActionResult> {
  const me = await requireAgentP();
  if (!me) return refuse(NOT_AUTHORISED);
  const id = Number(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim();
  if (!id) return refuse(INVALID_REQUEST);
  if (title.length < 3) return refuse("Title must be at least 3 characters.");
  const current = await db.problem.findUnique({ where: { id }, select: { status: true } });
  if (!current) return refuse(NOT_FOUND);
  const locked = fieldLockError(current.status, "title");
  if (locked) return refuse(locked);
  const { text: description, html: descriptionHtml } = readRichField(formData, "descriptionHtml", "description");
  const { count } = await db.problem.updateMany({ where: { id, status: current.status }, data: { title, description, descriptionHtml } });
  if (count === 0) return refuse(CHANGED_MEANWHILE);
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Problem", entityId: id, summary: "Edited details" });
  revalidatePath(`/problems/${id}`);
  revalidatePath("/problems");
  return OK;
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

export async function updateProblemText(formData: FormData): Promise<ProblemActionResult> {
  const me = await requireAgentP();
  if (!me) return refuse(NOT_AUTHORISED);
  const parsed = textSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refuse(INVALID_REQUEST);
  const { id, field } = parsed.data;
  const value = parsed.data.value.trim() || null;

  const current = await db.problem.findUnique({ where: { id }, select: { status: true } });
  if (!current) return refuse(NOT_FOUND);
  const locked = fieldLockError(current.status, field);
  if (locked) return refuse(locked);
  // Clearing the text the current status depends on would undo that status's gate.
  const missing = textEditError(current.status, field, value);
  if (missing) return refuse(missing);

  const { count } = await db.problem.updateMany({ where: { id, status: current.status }, data: { [field]: value } });
  if (count === 0) return refuse(CHANGED_MEANWHILE);
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Problem", entityId: id, summary: `Updated ${TEXT_LABELS[field]}` });
  revalidatePath(`/problems/${id}`);
  return OK;
}
