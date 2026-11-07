/**
 * Request bodies of the ITSM REST endpoints (/api/v1/changes, /problems,
 * comments) and their translation into the FormData the console's server
 * actions take. Pure and DB-free, so the contract is unit-testable; the
 * handlers in app/api/v1 run the actions as the token owner (lib/api-actor.ts).
 *
 * JSON is snake_case like the rest of /api/v1. Bodies are strict: an unknown
 * field is a 422 rather than silently ignored, so a typo in an automation
 * (`rollback_plna`) fails loudly instead of losing the rollback plan.
 */
import { z } from "zod";
import {
  CHANGE_OUTCOMES,
  CHANGE_STATUSES,
  CHANGE_TYPES,
  IMPACT_URGENCY,
  PRIORITIES,
  PROBLEM_STATUSES,
  RISKS,
} from "@/lib/constants";

const id = z.string().min(1);
const nullableId = id.nullable();
const text = z.string();
const isoDate = z.iso.datetime({ offset: true }).nullable();
const customFields = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const changeCreateSchema = z.strictObject({
  title: z.string().min(3),
  description: text.optional(),
  type: z.enum(CHANGE_TYPES).optional().default("NORMAL"),
  risk: z.enum(RISKS).optional().default("MEDIUM"),
  priority: z.enum(PRIORITIES).optional().default("MEDIUM"),
  impact: z.enum(IMPACT_URGENCY).optional().default("MEDIUM"),
  reason: text.optional(),
  implementation_plan: text.optional(),
  rollback_plan: text.optional(),
  assignee_id: id.optional(),
  group_id: id.optional(),
  category_id: id.optional(),
  planned_start: isoDate.optional(),
  planned_end: isoDate.optional(),
  asset_ids: z.array(id).max(200).optional(),
  custom_fields: customFields.optional(),
});

export const changePatchSchema = z
  .strictObject({
    title: z.string().min(3).optional(),
    description: text.optional(),
    type: z.enum(CHANGE_TYPES).optional(),
    risk: z.enum(RISKS).optional(),
    priority: z.enum(PRIORITIES).optional(),
    impact: z.enum(IMPACT_URGENCY).optional(),
    assignee_id: nullableId.optional(),
    group_id: nullableId.optional(),
    category_id: nullableId.optional(),
    reason: text.nullable().optional(),
    implementation_plan: text.nullable().optional(),
    rollback_plan: text.nullable().optional(),
    planned_start: isoDate.optional(),
    planned_end: isoDate.optional(),
    /** Required by the console rules when an approved change's window moves. */
    reschedule_reason: text.optional(),
    /** Emergency changes only: why a new window may fall into a change freeze. */
    justification: text.optional(),
    problem_id: z.number().int().positive().nullable().optional(),
  })
  .refine((b) => Object.keys(b).some((k) => k !== "reschedule_reason" && k !== "justification"), {
    message: "Nothing to update",
  });

export const changeTransitionSchema = z.strictObject({
  to: z.enum(CHANGE_STATUSES),
  outcome: z.enum(CHANGE_OUTCOMES).optional(),
  closure_notes: text.optional(),
  cancel_reason: text.optional(),
  /** Emergency changes: submitting into a change freeze needs a justification. */
  justification: text.optional(),
});

export const approvalDecisionSchema = z.strictObject({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: text.optional(),
});

export const problemCreateSchema = z.strictObject({
  title: z.string().min(3),
  description: text.optional(),
  status: z.enum(PROBLEM_STATUSES).optional().default("NEW"),
  priority: z.enum(PRIORITIES).optional().default("MEDIUM"),
  impact: z.enum(IMPACT_URGENCY).optional().default("MEDIUM"),
  assignee_id: id.optional(),
  group_id: id.optional(),
  category_id: id.optional(),
  custom_fields: customFields.optional(),
});

export const problemPatchSchema = z
  .strictObject({
    title: z.string().min(3).optional(),
    description: text.optional(),
    priority: z.enum(PRIORITIES).optional(),
    impact: z.enum(IMPACT_URGENCY).optional(),
    assignee_id: nullableId.optional(),
    group_id: nullableId.optional(),
    category_id: nullableId.optional(),
    root_cause: text.nullable().optional(),
    workaround: text.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

export const problemTransitionSchema = z.strictObject({ to: z.enum(PROBLEM_STATUSES) });

export const commentCreateSchema = z.strictObject({
  body: z.string().trim().min(1).max(50_000),
  /** Internal notes are visible to agents only. Default true: an automation must opt in to talking to the requester. */
  internal: z.boolean().optional().default(true),
});

export type ChangeCreate = z.infer<typeof changeCreateSchema>;
export type ChangePatch = z.infer<typeof changePatchSchema>;
export type ProblemCreate = z.infer<typeof problemCreateSchema>;
export type ProblemPatch = z.infer<typeof problemPatchSchema>;

type FormValue = string | number | boolean | null | undefined | readonly string[];

/**
 * FormData as the console's forms post it: undefined is left out, null becomes
 * "" (the actions read "" as "clear"), arrays repeat the key, custom fields
 * become `cf_<key>`.
 */
export function formOf(fields: Record<string, FormValue>, custom?: Record<string, string | number | boolean>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) fd.append(key, v);
    else fd.append(key, value === null ? "" : String(value));
  }
  for (const [key, value] of Object.entries(custom ?? {})) fd.append(`cf_${key}`, String(value));
  return fd;
}

/** The createChange action's form, from an API body. */
export function changeCreateForm(b: ChangeCreate): FormData {
  return formOf(
    {
      title: b.title,
      description: b.description ?? "",
      type: b.type,
      risk: b.risk,
      priority: b.priority,
      impact: b.impact,
      reason: b.reason,
      implementationPlan: b.implementation_plan,
      rollbackPlan: b.rollback_plan,
      assigneeId: b.assignee_id,
      groupId: b.group_id,
      categoryId: b.category_id,
      plannedStart: b.planned_start ?? undefined,
      plannedEnd: b.planned_end ?? undefined,
      assetIds: b.asset_ids,
    },
    b.custom_fields,
  );
}

/** The createProblem action's form, from an API body. */
export function problemCreateForm(b: ProblemCreate): FormData {
  return formOf(
    {
      title: b.title,
      description: b.description ?? "",
      status: b.status,
      priority: b.priority,
      impact: b.impact,
      assigneeId: b.assignee_id,
      groupId: b.group_id,
      categoryId: b.category_id,
    },
    b.custom_fields,
  );
}

/** One console edit a PATCH turns into, in the order they are applied. */
export type EditStep =
  | { kind: "details"; fields: string[]; title?: string; description?: string }
  | { kind: "field"; fields: string[]; field: string; value: string | null }
  | { kind: "text"; fields: string[]; field: string; value: string | null }
  | { kind: "window"; fields: string[]; plannedStart?: string | null; plannedEnd?: string | null; reason?: string; justification?: string }
  | { kind: "problem"; fields: string[]; problemId: number | null };

const CHANGE_FIELDS = { type: "type", risk: "risk", priority: "priority", impact: "impact", assignee_id: "assigneeId", group_id: "groupId", category_id: "categoryId" } as const;
const CHANGE_TEXTS = { reason: "reason", implementation_plan: "implementationPlan", rollback_plan: "rollbackPlan" } as const;
const PROBLEM_FIELDS = { priority: "priority", impact: "impact", assignee_id: "assigneeId", group_id: "groupId", category_id: "categoryId" } as const;
const PROBLEM_TEXTS = { root_cause: "rootCause", workaround: "workaround" } as const;

/**
 * A change PATCH as the sequence of console edits it stands for. Group comes
 * before assignee, so "move to group X and assign Y (a member of X)" works
 * in one request, as it would clicking through the UI.
 */
export function changeEditSteps(b: ChangePatch): EditStep[] {
  const steps: EditStep[] = [];
  if (b.title !== undefined || b.description !== undefined) {
    steps.push({ kind: "details", fields: ["title", "description"].filter((k) => k in b), title: b.title, description: b.description });
  }
  const order = ["type", "risk", "priority", "impact", "group_id", "assignee_id", "category_id"] as const;
  for (const key of order) {
    const value = b[key];
    if (value !== undefined) steps.push({ kind: "field", fields: [key], field: CHANGE_FIELDS[key], value });
  }
  for (const key of Object.keys(CHANGE_TEXTS) as (keyof typeof CHANGE_TEXTS)[]) {
    const value = b[key];
    if (value !== undefined) steps.push({ kind: "text", fields: [key], field: CHANGE_TEXTS[key], value });
  }
  if (b.planned_start !== undefined || b.planned_end !== undefined) {
    steps.push({
      kind: "window",
      fields: ["planned_start", "planned_end"].filter((k) => k in b),
      plannedStart: b.planned_start,
      plannedEnd: b.planned_end,
      reason: b.reschedule_reason,
      justification: b.justification,
    });
  }
  if (b.problem_id !== undefined) steps.push({ kind: "problem", fields: ["problem_id"], problemId: b.problem_id });
  return steps;
}

/** A problem PATCH as the sequence of console edits it stands for. */
export function problemEditSteps(b: ProblemPatch): EditStep[] {
  const steps: EditStep[] = [];
  if (b.title !== undefined || b.description !== undefined) {
    steps.push({ kind: "details", fields: ["title", "description"].filter((k) => k in b), title: b.title, description: b.description });
  }
  const order = ["priority", "impact", "group_id", "assignee_id", "category_id"] as const;
  for (const key of order) {
    const value = b[key];
    if (value !== undefined) steps.push({ kind: "field", fields: [key], field: PROBLEM_FIELDS[key], value });
  }
  for (const key of Object.keys(PROBLEM_TEXTS) as (keyof typeof PROBLEM_TEXTS)[]) {
    const value = b[key];
    if (value !== undefined) steps.push({ kind: "text", fields: [key], field: PROBLEM_TEXTS[key], value });
  }
  return steps;
}

/**
 * HTTP status for a console action's refusal message. The actions report
 * refusals as prose; this keeps the API's status codes meaningful without
 * changing every action's return type.
 */
export function refusalStatus(message: string): 403 | 404 | 409 | 422 {
  if (/not found/i.test(message)) return 404;
  if (/not authori[sz]ed|not signed in|only managers|only the assigned|cannot change the approval board|own or created|can't change this ticket/i.test(message)) return 403;
  if (/invalid request|isn't valid|must be at least|must come after|must be a member/i.test(message)) return 422;
  return 409;
}

/** Field-error keys from the console actions (camelCase) in the API's snake_case. */
export function snakeKeys<T>(errors: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(errors).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v]));
}
