/**
 * Bodies of the history-import endpoints (POST /api/v1/import/{tickets,problems,changes}).
 *
 * An import writes a record as it WAS in the source system: final status,
 * original timestamps, closure details and the comment thread. It deliberately
 * bypasses the lifecycle rules (no transition map, no CAB, no SLA clock, no
 * mail, no automations), so it is restricted to `admin`-scope tokens owned by
 * an ADMIN. `import_ref` (e.g. "glpi:change:129") identifies the source record:
 * sending it again returns the existing record instead of a duplicate, so a
 * migration can be re-run safely.
 *
 * Pure and DB-free (unit-tested); the handlers live in app/api/v1/import.
 */
import { z } from "zod";
import {
  CHANGE_OUTCOMES,
  CHANGE_STATUSES,
  CHANGE_TYPES,
  IMPACT_URGENCY,
  PRIORITIES,
  PROBLEM_STATUSES,
  RESOLUTION_CODES,
  RISKS,
  TICKET_STATUSES,
  TICKET_TYPES,
} from "@/lib/constants";

const at = z.iso.datetime({ offset: true });
const optAt = at.nullable().optional();
const id = z.string().min(1);
const text = z.string();
const customFields = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const importCommentSchema = z.strictObject({
  body: z.string().trim().min(1).max(100_000),
  internal: z.boolean().optional().default(true),
  /** Defaults to the token owner (e.g. for authors that no longer exist). */
  author_id: id.optional(),
  created_at: at,
});

const base = {
  import_ref: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  description: text.optional().default(""),
  created_at: at,
  /** Defaults to the latest timestamp in the record (incl. its comments). */
  updated_at: optAt,
  comments: z.array(importCommentSchema).max(1000).optional().default([]),
  custom_fields: customFields.optional(),
};

export const changeImportSchema = z.strictObject({
  ...base,
  type: z.enum(CHANGE_TYPES).optional().default("NORMAL"),
  status: z.enum(CHANGE_STATUSES),
  risk: z.enum(RISKS).optional().default("MEDIUM"),
  priority: z.enum(PRIORITIES).optional().default("MEDIUM"),
  impact: z.enum(IMPACT_URGENCY).optional().default("MEDIUM"),
  reason: text.nullable().optional(),
  implementation_plan: text.nullable().optional(),
  rollback_plan: text.nullable().optional(),
  outcome: z.enum(CHANGE_OUTCOMES).nullable().optional(),
  closure_notes: text.nullable().optional(),
  cancel_reason: text.nullable().optional(),
  assignee_id: id.nullable().optional(),
  created_by_id: id.nullable().optional(),
  group_id: id.nullable().optional(),
  category_id: id.nullable().optional(),
  problem_id: z.number().int().positive().nullable().optional(),
  planned_start: optAt,
  planned_end: optAt,
  actual_start: optAt,
  actual_end: optAt,
});

export const problemImportSchema = z.strictObject({
  ...base,
  status: z.enum(PROBLEM_STATUSES),
  priority: z.enum(PRIORITIES).optional().default("MEDIUM"),
  impact: z.enum(IMPACT_URGENCY).optional().default("MEDIUM"),
  root_cause: text.nullable().optional(),
  workaround: text.nullable().optional(),
  assignee_id: id.nullable().optional(),
  group_id: id.nullable().optional(),
  category_id: id.nullable().optional(),
  resolved_at: optAt,
});

export const ticketImportSchema = z.strictObject({
  ...base,
  type: z.enum(TICKET_TYPES).optional().default("INCIDENT"),
  status: z.enum(TICKET_STATUSES),
  priority: z.enum(PRIORITIES).optional().default("MEDIUM"),
  impact: z.enum(IMPACT_URGENCY).optional().default("MEDIUM"),
  urgency: z.enum(IMPACT_URGENCY).optional().default("MEDIUM"),
  /** Defaults to the token owner. */
  requester_id: id.optional(),
  assignee_id: id.nullable().optional(),
  group_id: id.nullable().optional(),
  category_id: id.nullable().optional(),
  service_id: id.nullable().optional(),
  problem_id: z.number().int().positive().nullable().optional(),
  change_id: z.number().int().positive().nullable().optional(),
  resolution_code: z.enum(RESOLUTION_CODES).nullable().optional(),
  resolution_note: text.nullable().optional(),
  first_response_at: optAt,
  resolved_at: optAt,
  closed_at: optAt,
});

export type ChangeImport = z.infer<typeof changeImportSchema>;
export type ProblemImport = z.infer<typeof problemImportSchema>;
export type TicketImport = z.infer<typeof ticketImportSchema>;
type AnyImport = ChangeImport | ProblemImport | TicketImport;

const date = (v: string | null | undefined) => (v ? new Date(v) : null);

/** The record's last-touched time: explicit updated_at, else the latest timestamp it carries. */
export function importUpdatedAt(b: AnyImport): Date {
  if (b.updated_at) return new Date(b.updated_at);
  const candidates: (string | null | undefined)[] = [b.created_at, ...b.comments.map((c) => c.created_at)];
  for (const key of ["actual_end", "actual_start", "resolved_at", "closed_at", "first_response_at"] as const) {
    const v = (b as unknown as Record<string, unknown>)[key];
    if (typeof v === "string") candidates.push(v);
  }
  return new Date(Math.max(...candidates.filter((v): v is string => Boolean(v)).map((v) => Date.parse(v))));
}

/**
 * Timeline problems the database would happily store but that make the record
 * nonsensical (e.g. closed before it was created). Field -> messages, empty when fine.
 */
export function importTimelineErrors(b: AnyImport): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const created = Date.parse(b.created_at);
  const add = (field: string, message: string) => (errors[field] ??= []).push(message);
  const record = b as unknown as Record<string, unknown>;
  for (const key of ["updated_at", "actual_start", "actual_end", "resolved_at", "closed_at", "first_response_at"]) {
    const v = record[key];
    if (typeof v === "string" && Date.parse(v) < created) add(key, "Must not be before created_at");
  }
  b.comments.forEach((c, i) => {
    if (Date.parse(c.created_at) < created) add(`comments.${i}.created_at`, "Must not be before created_at");
  });
  const pairs: [string, string][] = [["planned_start", "planned_end"], ["actual_start", "actual_end"]];
  for (const [from, to] of pairs) {
    const a = record[from], z2 = record[to];
    if (typeof a === "string" && typeof z2 === "string" && Date.parse(z2) < Date.parse(a)) add(to, `Must not be before ${from}`);
  }
  return errors;
}

/** Every user id a record references (owner, creator, requester, comment authors), deduplicated. */
export function referencedUserIds(b: AnyImport): string[] {
  const r = b as unknown as Record<string, unknown>;
  const ids = [r.assignee_id, r.created_by_id, r.requester_id, ...b.comments.map((c) => c.author_id)];
  return [...new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

/** Prisma data for an imported change (relations as plain ids). */
export function changeImportData(b: ChangeImport, actorId: string) {
  return {
    importRef: b.import_ref,
    title: b.title,
    description: b.description,
    type: b.type,
    status: b.status,
    risk: b.risk,
    priority: b.priority,
    impact: b.impact,
    reason: b.reason ?? null,
    implementationPlan: b.implementation_plan ?? null,
    rollbackPlan: b.rollback_plan ?? null,
    outcome: b.outcome ?? null,
    closureNotes: b.closure_notes ?? null,
    cancelReason: b.cancel_reason ?? null,
    assigneeId: b.assignee_id ?? null,
    createdById: b.created_by_id ?? actorId,
    groupId: b.group_id ?? null,
    categoryId: b.category_id ?? null,
    problemId: b.problem_id ?? null,
    plannedStart: date(b.planned_start),
    plannedEnd: date(b.planned_end),
    actualStart: date(b.actual_start),
    actualEnd: date(b.actual_end),
    ...(b.custom_fields && Object.keys(b.custom_fields).length ? { customFields: JSON.stringify(b.custom_fields) } : {}),
    createdAt: new Date(b.created_at),
    updatedAt: importUpdatedAt(b),
  };
}

export function problemImportData(b: ProblemImport) {
  return {
    importRef: b.import_ref,
    title: b.title,
    description: b.description,
    status: b.status,
    priority: b.priority,
    impact: b.impact,
    rootCause: b.root_cause ?? null,
    workaround: b.workaround ?? null,
    assigneeId: b.assignee_id ?? null,
    groupId: b.group_id ?? null,
    categoryId: b.category_id ?? null,
    resolvedAt: date(b.resolved_at),
    ...(b.custom_fields && Object.keys(b.custom_fields).length ? { customFields: JSON.stringify(b.custom_fields) } : {}),
    createdAt: new Date(b.created_at),
    updatedAt: importUpdatedAt(b),
  };
}

export function ticketImportData(b: TicketImport, actorId: string, prefix: string) {
  return {
    importRef: b.import_ref,
    title: b.title,
    description: b.description,
    type: b.type,
    prefix,
    status: b.status,
    priority: b.priority,
    impact: b.impact,
    urgency: b.urgency,
    // Imported tickets keep source API; importRef marks where they came from.
    source: "API",
    requesterId: b.requester_id ?? actorId,
    assigneeId: b.assignee_id ?? null,
    groupId: b.group_id ?? null,
    categoryId: b.category_id ?? null,
    serviceId: b.service_id ?? null,
    problemId: b.problem_id ?? null,
    changeId: b.change_id ?? null,
    resolutionCode: b.resolution_code ?? null,
    resolutionNote: b.resolution_note ?? null,
    firstResponseAt: date(b.first_response_at),
    resolvedAt: date(b.resolved_at),
    closedAt: date(b.closed_at),
    ...(b.custom_fields && Object.keys(b.custom_fields).length ? { customFields: JSON.stringify(b.custom_fields) } : {}),
    createdAt: new Date(b.created_at),
    updatedAt: importUpdatedAt(b),
  };
}

/** Comment rows for an imported thread (the parent id is set by the nested create). */
export function importCommentRows(b: AnyImport, actorId: string) {
  return b.comments.map((c) => ({
    body: c.body,
    bodyHtml: null,
    isInternal: c.internal,
    authorId: c.author_id ?? actorId,
    createdAt: new Date(c.created_at),
  }));
}
