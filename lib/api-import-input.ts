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
 * The update mode (PUT /api/v1/import/{type}/{import_ref}) takes the same
 * bodies and brings an imported record up to the source's current state:
 * `planReimport` diffs the stored columns against the payload and picks the
 * comments that are not there yet (by comment `import_ref`, else by body +
 * created_at).
 *
 * Pure and DB-free (unit-tested); the handlers live in app/api/v1/_import.ts.
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

const importRef = z.string().trim().min(1).max(200);

export const importCommentSchema = z.strictObject({
  /** Source id of the comment (e.g. "glpi:followup:812"): a re-import never adds it twice. */
  import_ref: importRef.optional(),
  body: z.string().trim().min(1).max(100_000),
  internal: z.boolean().optional().default(true),
  /** Defaults to the token owner (e.g. for authors that no longer exist). */
  author_id: id.optional(),
  created_at: at,
});

const base = {
  import_ref: importRef,
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

/**
 * Bodies of the update mode: the import bodies with `import_ref` taken from the
 * path (allowed in the body only when equal, see `reimportRefErrors`).
 */
export const changeReimportSchema = changeImportSchema.extend({ import_ref: importRef.optional() });
export const problemReimportSchema = problemImportSchema.extend({ import_ref: importRef.optional() });
export const ticketReimportSchema = ticketImportSchema.extend({ import_ref: importRef.optional() });

export type ChangeImport = z.infer<typeof changeImportSchema>;
export type ProblemImport = z.infer<typeof problemImportSchema>;
export type TicketImport = z.infer<typeof ticketImportSchema>;
type AnyImport = ChangeImport | ProblemImport | TicketImport;
export type ImportComment = z.infer<typeof importCommentSchema>;

/**
 * The `{import_ref}` path segment as a ref, or null when it cannot be one an
 * import stores (empty, longer than 200 chars, surrounding whitespace). A null
 * never reaches the lookup, so a natively created record (importRef null) can
 * never be addressed by the update mode.
 */
export function importRefFromPath(raw: string): string | null {
  let ref = raw;
  try {
    ref = decodeURIComponent(raw);
  } catch {
    // not valid percent-encoding: take it as is
  }
  return ref.length > 0 && ref.length <= 200 && ref.trim() === ref ? ref : null;
}

/** 422 details when the body names a different `import_ref` than the path. */
export function reimportRefErrors(pathRef: string, bodyRef: string | undefined): Record<string, string[]> {
  return bodyRef !== undefined && bodyRef !== pathRef ? { import_ref: [`Must match the path (${pathRef}) or be left out`] } : {};
}

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

/** A comment `import_ref` sent twice in one record (the ref is unique per record). Field -> messages. */
export function importCommentRefErrors(b: AnyImport): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const seen = new Set<string>();
  b.comments.forEach((c, i) => {
    if (!c.import_ref) return;
    if (seen.has(c.import_ref)) errors[`comments.${i}.import_ref`] = ["Duplicate import_ref within this record"];
    seen.add(c.import_ref);
  });
  return errors;
}

/** Everything the schema cannot see: timeline problems and duplicate comment refs. */
export function importValidationErrors(b: AnyImport): Record<string, string[]> {
  return { ...importTimelineErrors(b), ...importCommentRefErrors(b) };
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
  return commentRows(b.comments, actorId);
}

/** Comment rows for the given comments (used by the update mode for the new ones only). */
export function commentRows(comments: ImportComment[], actorId: string) {
  return comments.map((c) => ({
    body: c.body,
    bodyHtml: null,
    isInternal: c.internal,
    authorId: c.author_id ?? actorId,
    createdAt: new Date(c.created_at),
    importRef: c.import_ref ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Update mode (PUT /api/v1/import/{type}/{import_ref})
// ---------------------------------------------------------------------------

/** A comment already on the record, as far as the dedup needs it. */
export type StoredComment = { body: string; createdAt: Date; importRef: string | null };

/**
 * The comments of the payload that the record does not have yet, in payload
 * order. A comment with an `import_ref` matches the stored comment with that
 * ref. Any other comment, and a ref'd one whose ref is not stored yet (e.g. a
 * thread first imported without refs), matches a stored comment with the same
 * body and `created_at` (to the millisecond) that carries no ref of its own.
 * Each stored comment matches at most once, so two identical source comments
 * stay two. Stored comments are never edited or removed, also not the ones
 * written in Servio after the import.
 */
export function commentsToAdd<C extends ImportComment>(incoming: C[], stored: StoredComment[]): C[] {
  const used = new Set<number>();
  const byRef = new Map<string, number>();
  stored.forEach((s, i) => {
    if (s.importRef) byRef.set(s.importRef, i);
  });
  const pending: C[] = [];
  for (const c of incoming) {
    const i = c.import_ref ? byRef.get(c.import_ref) : undefined;
    if (i !== undefined && !used.has(i)) used.add(i);
    else pending.push(c);
  }
  return pending.filter((c) => {
    const at = Date.parse(c.created_at);
    // A stored ref belongs to one source comment; a content match may only claim a ref-less row
    // (or, for a ref-less payload comment, any row with the same content).
    const i = stored.findIndex(
      (s, j) => !used.has(j) && (!c.import_ref || !s.importRef) && s.createdAt.getTime() === at && s.body === c.body,
    );
    if (i === -1) return true;
    used.add(i);
    return false;
  });
}

/** camelCase column -> snake_case API field (`closureNotes` -> `closure_notes`). */
export const apiFieldName = (column: string) => column.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** JSON with sorted keys, so `{a,b}` and `{b,a}` compare equal. */
function canonicalJson(raw: unknown): string {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  const sort = (x: unknown): unknown =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])]))
      : x;
  return JSON.stringify(sort(v ?? {}));
}

function sameValue(column: string, a: unknown, b: unknown): boolean {
  if (column === "customFields") return canonicalJson(a) === canonicalJson(b);
  if (a instanceof Date || b instanceof Date) {
    const t = (v: unknown) => (v instanceof Date ? v.getTime() : v == null ? null : new Date(v as string).getTime());
    return t(a) === t(b);
  }
  return (a ?? null) === (b ?? null);
}

/**
 * The columns a re-import owns, from the create mapping (`*ImportData`). The
 * payload is the source's full current state, so an omitted optional field
 * falls back to its default (`risk` MEDIUM, `outcome` null, ...) exactly as on
 * the first import. Left alone: what is fixed at creation (`importRef`, ticket
 * `prefix` and `source`), `updatedAt` (see `planReimport`), and — unless the
 * payload sends them — the fields that default to the token owner
 * (`created_by_id`, `requester_id`, so a re-run by another admin does not
 * rewrite them) and `custom_fields` (only written when sent; `{}` clears).
 */
export function reimportColumns(full: Record<string, unknown>, b: AnyImport): Record<string, unknown> {
  const sent = b as unknown as Record<string, unknown>;
  const cols = { ...full };
  for (const key of ["importRef", "prefix", "source", "updatedAt"]) delete cols[key];
  if ("createdById" in cols && sent.created_by_id == null) delete cols.createdById;
  if ("requesterId" in cols && sent.requester_id === undefined) delete cols.requesterId;
  if (b.custom_fields === undefined) delete cols.customFields;
  else cols.customFields = JSON.stringify(b.custom_fields);
  return cols;
}

export type ReimportPlan<C> = {
  /** Columns to write (always with `updatedAt`), or null when nothing is to be written. */
  data: Record<string, unknown> | null;
  /** API field names whose value changes. */
  changed: string[];
  /** Comments to append. */
  comments: C[];
  /** 422 details (field -> messages); when non-empty nothing may be written. */
  errors: Record<string, string[]>;
};

/**
 * What a re-import changes on a stored record: `columns` from
 * `reimportColumns`, `current` the stored row, `stored` its comments.
 *
 * `updated_at` follows the import rules (the sent value, else the latest
 * timestamp of the payload) but only forces a write when it was sent and
 * differs; a derived one is written along with a real change only.
 * `created_at` is part of the source state and replaced like any other field,
 * but may not move past a comment the record keeps.
 */
export function planReimport<C extends ImportComment>(
  b: AnyImport & { comments: C[] },
  columns: Record<string, unknown>,
  current: Record<string, unknown>,
  stored: StoredComment[],
): ReimportPlan<C> {
  const changedColumns = Object.keys(columns).filter((k) => !sameValue(k, current[k], columns[k]));
  const updatedAt = importUpdatedAt(b);
  if (b.updated_at && !sameValue("updatedAt", current.updatedAt, updatedAt)) changedColumns.push("updatedAt");
  const comments = commentsToAdd(b.comments, stored);
  const changed = changedColumns.map(apiFieldName);

  const errors: Record<string, string[]> = {};
  if (changedColumns.includes("createdAt") && stored.length) {
    const earliest = Math.min(...stored.map((s) => s.createdAt.getTime()));
    if (earliest < (columns.createdAt as Date).getTime()) {
      errors.created_at = [`Must not be after the record's earliest comment (${new Date(earliest).toISOString()})`];
    }
  }
  if (Object.keys(errors).length || (!changedColumns.length && !comments.length)) return { data: null, changed, comments, errors };

  const data: Record<string, unknown> = Object.fromEntries(changedColumns.map((k) => [k, columns[k]]));
  data.updatedAt = updatedAt;
  return { data, changed, comments, errors };
}
