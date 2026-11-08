// Shared model for dynamic service-request forms (stored as JSON on Service.formSchema).

export const FIELD_TYPES = [
  "text",
  "textarea",
  "select",
  "number",
  "date",
  "checkbox",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type ServiceField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[]; // for select
  placeholder?: string;
  help?: string;
};

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
    values[f.key] = v;
  }
  return { values, errors };
}

/** Render answers as a readable text block (for ticket description / email). */
export function answersToText(fields: ServiceField[], values: Record<string, unknown>) {
  return fields
    .map((f) => {
      const v = values[f.key];
      const shown = f.type === "checkbox" ? (v ? "Yes" : "No") : String(v ?? "—");
      return `• ${f.label}: ${shown}`;
    })
    .join("\n");
}
