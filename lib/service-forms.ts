// Shared model for dynamic service-request forms (stored as JSON on Service.formSchema).

export const FIELD_TYPES = [
  "text",
  "textarea",
  "select",
  "multiselect",
  "number",
  "date",
  "datetime",
  "checkbox",
  // Mapped onto the ticket, not only stored as an answer:
  "urgency", // the ticket's urgency and priority (LOW / MEDIUM / HIGH)
  "asset", // one of the requester's own assets, linked to the ticket
  "people", // colleagues (by email) added to the ticket as participants
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type ServiceField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[]; // for select / multiselect
  placeholder?: string;
  help?: string;
};

/** What a catalog request becomes: a service request (the default) or an incident. */
export const CATALOG_TICKET_TYPES = ["REQUEST", "INCIDENT"] as const;
export type CatalogTicketType = (typeof CATALOG_TICKET_TYPES)[number];

export function catalogTicketType(value: string | null | undefined): CatalogTicketType {
  return value === "INCIDENT" ? "INCIDENT" : "REQUEST";
}

/** Levels of an "urgency" question; the ticket gets the same urgency and priority. */
export const FORM_URGENCY_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;
export type FormUrgency = (typeof FORM_URGENCY_LEVELS)[number];
const URGENCY_LABEL: Record<FormUrgency, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

/** Most colleagues one "people" question may add. */
export const MAX_FORM_PEOPLE = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** A multi-value answer: a JSON array (the portal form) or a comma / line separated list (the assistant). */
export function parseMultiValue(raw: string | null | undefined): string[] {
  const text = (raw ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) return [...new Set(arr.map((v) => String(v).trim()).filter(Boolean))];
    } catch {
      // not JSON after all: fall through to the list form
    }
  }
  return [...new Set(text.split(/[,;\n]/).map((v) => v.trim()).filter(Boolean))];
}

export function parseFormSchema(json: string | null | undefined): ServiceField[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.filter((f) => f && typeof f.key === "string" && typeof f.label === "string");
  } catch {
    return [];
  }
}

/** Upper bound on a single free-text answer, to cap stored form payloads. */
export const MAX_ANSWER_LEN = 5000;

// ---------------------------------------------------------------------------
// Multi-stage catalog approvals
//
// A CatalogItem can carry an ORDERED list of approval stages (CatalogItem.
// approvalStages, JSON). Each stage names EITHER a single approver OR a group
// (any active agent member of that group may decide the stage). A request walks
// the stages in order; the last stage approving releases the request. Legacy
// single-approver items (approvalStages null) still work as an implicit one
// stage built from CatalogItem.approverId.
// ---------------------------------------------------------------------------

export type ApprovalStage = {
  /** Named single approver (mutually exclusive with groupId). */
  approverId?: string | null;
  /** Group whose active agents can decide this stage (mutually exclusive with approverId). */
  groupId?: string | null;
};

/** Cap on the number of ordered stages an item may define. */
export const MAX_APPROVAL_STAGES = 10;

/** Parse the stored approvalStages JSON into a clean, ordered list. Drops empty
 *  descriptors (neither approver nor group) and normalises to at most one target
 *  per stage (approver wins if both are somehow present). */
export function parseApprovalStages(json: string | null | undefined): ApprovalStage[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    const out: ApprovalStage[] = [];
    for (const raw of arr) {
      if (!raw || typeof raw !== "object") continue;
      const approverId = typeof raw.approverId === "string" && raw.approverId.trim() ? raw.approverId.trim() : null;
      const groupId = typeof raw.groupId === "string" && raw.groupId.trim() ? raw.groupId.trim() : null;
      if (approverId) out.push({ approverId, groupId: null });
      else if (groupId) out.push({ approverId: null, groupId });
      if (out.length >= MAX_APPROVAL_STAGES) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Serialise stages for storage; returns null when there are no valid stages so
 *  the item falls back to the legacy single-approver behaviour. */
export function serializeApprovalStages(stages: ApprovalStage[]): string | null {
  const clean = stages
    .map((s) => {
      const approverId = s.approverId?.trim() || null;
      const groupId = s.groupId?.trim() || null;
      return approverId ? { approverId } : groupId ? { groupId } : null;
    })
    .filter((s): s is { approverId: string } | { groupId: string } => s !== null)
    .slice(0, MAX_APPROVAL_STAGES);
  return clean.length > 0 ? JSON.stringify(clean) : null;
}

/**
 * Resolve the effective ordered stages for an item. Prefers the explicit
 * approvalStages list; falls back to a single implicit stage built from the
 * legacy approverId so old items keep working unchanged.
 */
export function effectiveApprovalStages(item: {
  approvalStages?: string | null;
  approverId?: string | null;
}): ApprovalStage[] {
  const stages = parseApprovalStages(item.approvalStages);
  if (stages.length > 0) return stages;
  if (item.approverId) return [{ approverId: item.approverId, groupId: null }];
  return [];
}

export const NO_APPROVER_CONFIGURED = "This item requires approval but has no approver configured. Please contact IT.";
export const APPROVER_UNAVAILABLE = "This item requires approval but its approver is no longer available. Please contact IT.";

/**
 * The approval stages a new request of `item` walks, or why it can't be requested.
 * Judged on the item's ORDERED stages (a group-only first stage counts), never on
 * the mirrored CatalogItem.approverId alone. `firstStageSeatable` says whether the
 * first stage resolves to an active agent right now (a named approver or any
 * active agent member of the stage's group).
 */
export function catalogApprovalPlan(
  item: { requiresApproval: boolean; approvalStages?: string | null; approverId?: string | null },
  firstStageSeatable: boolean,
): { stages: ApprovalStage[] } | { error: string } {
  if (!item.requiresApproval) return { stages: [] };
  const stages = effectiveApprovalStages(item);
  if (stages.length === 0) return { error: NO_APPROVER_CONFIGURED };
  if (!firstStageSeatable) return { error: APPROVER_UNAVAILABLE };
  return { stages };
}

/** Validate submitted answers against a schema. Returns {values, errors}. */
export function validateAnswers(
  fields: ServiceField[],
  data: Record<string, string>,
): { values: Record<string, unknown>; errors: Record<string, string> } {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const raw = data[`f_${f.key}`];
    if (f.type === "checkbox") {
      values[f.key] = raw === "on" || raw === "true";
      if (f.required && !values[f.key]) errors[f.key] = "Required";
      continue;
    }
    const v = (raw ?? "").trim();
    if (f.required && !v) {
      errors[f.key] = "This field is required";
      continue;
    }
    if (v.length > MAX_ANSWER_LEN) {
      errors[f.key] = `Answer is too long (max ${MAX_ANSWER_LEN} characters)`;
      continue;
    }
    if (f.type === "number" && v && Number.isNaN(Number(v))) {
      errors[f.key] = "Must be a number";
      continue;
    }
    if (f.type === "select" && v && Array.isArray(f.options) && !f.options.includes(v)) {
      errors[f.key] = "Invalid selection";
      continue;
    }
    if (f.type === "multiselect") {
      const picked = parseMultiValue(v);
      if (f.required && picked.length === 0) errors[f.key] = "This field is required";
      else if (picked.some((o) => !(f.options ?? []).includes(o))) errors[f.key] = "Invalid selection";
      else values[f.key] = picked;
      continue;
    }
    if (f.type === "datetime" && v && (!DATETIME_RE.test(v) || Number.isNaN(new Date(v).getTime()))) {
      errors[f.key] = "Enter a date and time";
      continue;
    }
    if (f.type === "urgency" && v && !(FORM_URGENCY_LEVELS as readonly string[]).includes(v)) {
      errors[f.key] = "Invalid selection";
      continue;
    }
    if (f.type === "people") {
      // Resolved to user accounts by createCatalogRequestFor; here only the shape is checked.
      const emails = parseMultiValue(v).map((e) => e.toLowerCase());
      if (emails.some((e) => !EMAIL_RE.test(e))) errors[f.key] = "Enter email addresses separated by commas";
      else if (emails.length > MAX_FORM_PEOPLE) errors[f.key] = `Add at most ${MAX_FORM_PEOPLE} people`;
      else values[f.key] = emails;
      continue;
    }
    values[f.key] = v;
  }
  return { values, errors };
}

/** The answer of the first "urgency" question, if any. */
export function formUrgency(fields: ServiceField[], values: Record<string, unknown>): FormUrgency | null {
  const field = fields.find((f) => f.type === "urgency");
  const v = field ? values[field.key] : null;
  return typeof v === "string" && (FORM_URGENCY_LEVELS as readonly string[]).includes(v) ? (v as FormUrgency) : null;
}

/** One answer as plain text (stored English, like every generated description). */
export function answerText(f: ServiceField, v: unknown): string {
  if (f.type === "checkbox") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (v == null || v === "") return "—";
  if (f.type === "urgency") return URGENCY_LABEL[v as FormUrgency] ?? String(v);
  if (f.type === "datetime") return String(v).replace("T", " ");
  return String(v);
}

/** Longest ticket title a title template may produce. */
export const MAX_TITLE_LEN = 200;

/**
 * The ticket title from an item's title template: {{item}}, {{requester}} and
 * {{<question key>}} are replaced (unknown placeholders become empty). Falls back to
 * "<Item> request" when there is no template or it renders empty.
 */
export function renderCatalogTitle(
  template: string | null | undefined,
  ctx: { itemName: string; requesterName: string; fields: ServiceField[]; values: Record<string, unknown> },
): string {
  const fallback = `${ctx.itemName} request`;
  if (!template?.trim()) return fallback;
  const byKey = new Map(ctx.fields.map((f) => [f.key, f]));
  const rendered = template
    .replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, key: string) => {
      if (key === "item") return ctx.itemName;
      if (key === "requester") return ctx.requesterName;
      const field = byKey.get(key);
      if (!field) return "";
      const text = answerText(field, ctx.values[key]);
      return text === "—" ? "" : text;
    })
    .replace(/\s+/g, " ")
    .trim();
  return (rendered || fallback).slice(0, MAX_TITLE_LEN);
}

/** Render answers as a readable text block (for ticket description / email). */
export function answersToText(fields: ServiceField[], values: Record<string, unknown>) {
  return fields
    .map((f) => {
      return `• ${f.label}: ${answerText(f, values[f.key])}`;
    })
    .join("\n");
}
