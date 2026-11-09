/** Pure business rules for standard change templates, shared by the server actions, the UI and their tests. */

export type ChangeTemplateDefaults = {
  type: string;
  title: string;
  description: string;
  reason: string | null;
  implementationPlan: string | null;
  rollbackPlan: string | null;
  risk: string;
  priority: string;
  impact: string;
  categoryId: string | null;
  groupId: string | null;
};

/**
 * What the requester may change on top of a template. A missing key keeps the template's
 * value; `null` (or a blank text) clears an optional one.
 */
export type ChangeTemplateOverrides = Partial<{
  title: string | null;
  description: string | null;
  reason: string | null;
  implementationPlan: string | null;
  rollbackPlan: string | null;
  risk: string;
  priority: string;
  impact: string;
  assigneeId: string | null;
  groupId: string | null;
  categoryId: string | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
}>;

export type TemplatedChange = ChangeTemplateDefaults & {
  assigneeId: string | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
};

/** A STANDARD template is the pre-authorized procedure: a change made from it skips the CAB. */
export function isPreAuthorized(templateType: string): boolean {
  return templateType === "STANDARD";
}

export const STANDARD_TEMPLATE_PLANS_MESSAGE =
  "A standard template needs an implementation plan and a rollback plan, because its changes skip CAB review.";

/** Why a template cannot be saved as it is, or null. */
export function templateProblem(t: {
  type: string;
  implementationPlan: string | null;
  rollbackPlan: string | null;
}): string | null {
  if (!isPreAuthorized(t.type)) return null;
  return t.implementationPlan?.trim() && t.rollbackPlan?.trim() ? null : STANDARD_TEMPLATE_PLANS_MESSAGE;
}

const blankToNull = (v: string | null | undefined): string | null => (v?.trim() ? v.trim() : null);

/** A text field: the template's value unless the requester supplied one (blank clears it). */
function text(override: string | null | undefined, fallback: string | null): string | null {
  return override === undefined ? fallback : blankToNull(override);
}

/**
 * The change to create from a template. Pre-authorized templates fix the type, risk, impact and plans:
 * the pre-approval is earned by that procedure, so the requester cannot edit it per change.
 */
export function applyTemplate(template: ChangeTemplateDefaults, overrides: ChangeTemplateOverrides): TemplatedChange {
  const fixed = isPreAuthorized(template.type);
  return {
    type: template.type,
    title: blankToNull(overrides.title) ?? template.title,
    description: overrides.description === undefined ? template.description : overrides.description?.trim() ?? "",
    reason: text(overrides.reason, template.reason),
    implementationPlan: fixed ? template.implementationPlan : text(overrides.implementationPlan, template.implementationPlan),
    rollbackPlan: fixed ? template.rollbackPlan : text(overrides.rollbackPlan, template.rollbackPlan),
    risk: fixed ? template.risk : overrides.risk ?? template.risk,
    priority: overrides.priority ?? template.priority,
    impact: fixed ? template.impact : overrides.impact ?? template.impact,
    categoryId: overrides.categoryId === undefined ? template.categoryId : overrides.categoryId,
    groupId: overrides.groupId === undefined ? template.groupId : overrides.groupId,
    assigneeId: overrides.assigneeId ?? null,
    plannedStart: overrides.plannedStart ?? null,
    plannedEnd: overrides.plannedEnd ?? null,
  };
}

/** What the pre-approval depends on: a template's type, switch, risk, impact and procedure. */
export type TemplateApprovalState = {
  type: string;
  isActive: boolean;
  risk: string;
  impact: string;
  implementationPlan: string | null;
  rollbackPlan: string | null;
};

const APPROVAL_FIELDS = ["type", "isActive", "risk", "impact", "implementationPlan", "rollbackPlan"] as const;

export const STANDARD_TEMPLATE_APPROVER_MESSAGE =
  "Only a role that may approve changes of this risk can save an active standard template, because its changes skip CAB review.";

/**
 * A standard template is a pre-approved change: whoever defines it approves every
 * change made from it. So writing an active STANDARD template (creating it, activating it, or
 * touching its type, risk, impact or procedure) takes a role that may sit on the CAB for its
 * risk (only ADMIN for HIGH). `current` is the stored template (null on create); `next` the
 * result of the write. Returns the refusal message, or null when the write is fine.
 */
export function standardTemplateApprovalProblem(
  role: string,
  current: TemplateApprovalState | null,
  next: TemplateApprovalState,
  approverRolesForRisk: (risk: string) => string[],
): string | null {
  if (!isPreAuthorized(next.type) || !next.isActive) return null;
  const touched = !current || APPROVAL_FIELDS.some((k) => current[k] !== next[k]);
  if (!touched) return null;
  // Lowering the risk of an existing pre-approved template needs the rank its old risk demanded.
  const risks = current && isPreAuthorized(current.type) && current.isActive ? [current.risk, next.risk] : [next.risk];
  return risks.every((r) => approverRolesForRisk(r).includes(role)) ? null : STANDARD_TEMPLATE_APPROVER_MESSAGE;
}

export const TEMPLATE_TYPE_FIXED_MESSAGE = "A change made from a template has the template's type; omit it or send the template's own.";
export const TEMPLATE_PROCEDURE_FIXED_MESSAGE =
  "Fixed by the standard template (its changes skip CAB review); omit it or send the template's own value.";

/** The API fields a pre-authorized template fixes: the pre-approval is earned by exactly this procedure. */
const FIXED_BY_PRE_AUTHORIZATION = [
  ["risk", "risk"],
  ["impact", "impact"],
  ["implementation_plan", "implementationPlan"],
  ["rollback_plan", "rollbackPlan"],
] as const;

/**
 * Fields of a create-from-template request that contradict the template, as API field errors
 * (empty when none). `applyTemplate` ignores such overrides; the API refuses them instead, so a
 * client never believes it changed something that stayed as the template says. Sending the
 * template's own value is accepted.
 */
export function templateOverrideConflicts(
  template: Pick<ChangeTemplateDefaults, "type" | "risk" | "impact" | "implementationPlan" | "rollbackPlan">,
  body: { type?: string; risk?: string; impact?: string; implementation_plan?: string; rollback_plan?: string },
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (body.type !== undefined && body.type !== template.type) errors.type = [TEMPLATE_TYPE_FIXED_MESSAGE];
  if (!isPreAuthorized(template.type)) return errors;
  for (const [field, column] of FIXED_BY_PRE_AUTHORIZATION) {
    const sent = body[field];
    if (sent === undefined) continue;
    const sameText = (blankToNull(sent) ?? "") === (blankToNull(template[column]) ?? "");
    if (!sameText) errors[field] = [TEMPLATE_PROCEDURE_FIXED_MESSAGE];
  }
  return errors;
}
