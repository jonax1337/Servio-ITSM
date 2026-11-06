import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { writeAudit, notify } from "@/lib/audit";
import { submitChangeForApproval } from "@/lib/actions/changes";
import { plannedWindowError } from "@/lib/change-rules";
import { applyTemplate, isPreAuthorized, type ChangeTemplateOverrides } from "@/lib/change-template-rules";
import { assertRequiredCustomFields, entityFieldValues, type CustomFieldDef } from "@/lib/custom-fields";

/**
 * Creating a change from a template. The caller (the form action or a Sable operation) has
 * already checked that the acting user is an agent. A STANDARD template's change goes through
 * the existing STANDARD path of submitChangeForApproval, which pre-approves it.
 */

export type CreateFromTemplateResult =
  | {
      ok: true;
      changeId: number;
      /** True when the change was pre-approved right away (STANDARD templates). */
      preApproved: boolean;
      /** Set when pre-approval was due but refused; the change then waits as a draft. */
      approvalError?: string;
    }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function createChangeFromTemplate(
  actorId: string,
  templateId: string,
  overrides: ChangeTemplateOverrides,
  customFields: Record<string, string> = {},
): Promise<CreateFromTemplateResult> {
  const template = await db.changeTemplate.findUnique({ where: { id: templateId } });
  if (!template) return { ok: false, error: "Template not found." };
  if (!template.isActive) return { ok: false, error: `The template "${template.name}" is switched off.` };

  const data = applyTemplate(template, overrides);
  const windowError = plannedWindowError(data.plannedStart, data.plannedEnd);
  if (windowError) return { ok: false, error: "Please fix the errors below.", fieldErrors: { plannedEnd: [windowError] } };

  const defs = await db.customFieldDef.findMany({ where: { entityType: "CHANGE", active: true } });
  if (defs.length > 0) {
    const check = assertRequiredCustomFields(
      defs as CustomFieldDef[],
      customFields,
      entityFieldValues({ type: data.type, priority: data.priority, risk: data.risk }),
    );
    if (!check.ok) return { ok: false, error: check.error };
  }

  const change = await db.change.create({
    data: {
      ...data,
      status: "DRAFT",
      createdById: actorId,
      templateId: template.id,
      ...(Object.keys(customFields).length ? { customFields: JSON.stringify(customFields) } : {}),
    },
    select: { id: true, title: true },
  });

  await writeAudit({
    userId: actorId,
    action: "CREATE",
    entity: "Change",
    entityId: change.id,
    summary: `Created change "${change.title}" from template "${template.name}"`,
  });
  if (data.assigneeId && data.assigneeId !== actorId) {
    await notify(data.assigneeId, {
      type: "ASSIGNED",
      title: "Change assigned to you",
      body: change.title,
      entity: "Change",
      entityId: String(change.id),
    });
  }
  revalidatePath("/changes");

  if (!isPreAuthorized(template.type)) return { ok: true, changeId: change.id, preApproved: false };

  const submission = new FormData();
  submission.set("id", String(change.id));
  const approval = await submitChangeForApproval(submission);
  return approval.ok
    ? { ok: true, changeId: change.id, preApproved: true }
    : { ok: true, changeId: change.id, preApproved: false, approvalError: approval.error };
}
