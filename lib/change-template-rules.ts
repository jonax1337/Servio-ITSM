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
