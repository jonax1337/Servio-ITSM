import { db } from "@/lib/db";
import { apiError, ok, type ApiPrincipal } from "@/lib/api";
import { createChangeFromTemplate } from "@/lib/change-templates";
import { templateOverrideConflicts } from "@/lib/change-template-rules";
import { snakeKeys, templateOverridesFrom, type ChangeCreate } from "@/lib/api-itsm-input";
import { CHANGE_INCLUDE, serializeChange } from "./_serializers";
import { asActor, refusal } from "./_itsm";

/**
 * POST /changes with `template_id` / `template_ref`: the console's "new change from template"
 * (lib/change-templates.ts) as the token's owner. Nothing here decides approval: a STANDARD
 * template's change goes through submitChangeForApproval's own STANDARD path, which re-reads the
 * template (type, active switch), checks plans and the freeze calendar and writes the audit row.
 * The caller has passed agentGuard (changes:write, an agent), the same gate as the console action.
 */
export async function createChangeFromTemplateRequest(principal: ApiPrincipal, body: ChangeCreate) {
  const template = await db.changeTemplate.findUnique({
    where: body.template_id ? { id: body.template_id } : { importRef: body.template_ref! },
  });
  if (!template) {
    const field = body.template_id ? "template_id" : "template_ref";
    return apiError(422, "Validation failed", { [field]: ["Unknown change template."] });
  }
  // Refused before anything is written; the helper re-checks it, this just gives the right status.
  if (!template.isActive) return apiError(409, `The template "${template.name}" is switched off.`);

  const conflicts = templateOverrideConflicts(template, body);
  if (Object.keys(conflicts).length > 0) return apiError(422, "Validation failed", conflicts);

  const unknown = await unknownReferences(body);
  if (unknown) return apiError(422, "Validation failed", unknown);

  const customFields = Object.fromEntries(Object.entries(body.custom_fields ?? {}).map(([k, v]) => [k, String(v)]));
  const result = await asActor(principal, () =>
    createChangeFromTemplate(principal.userId, template.id, templateOverridesFrom(body), customFields, [...new Set(body.asset_ids ?? [])]),
  );
  if (!result.ok) {
    if (result.fieldErrors) return apiError(422, result.error, snakeKeys(result.fieldErrors));
    return refusal(result.error);
  }

  const change = await db.change.findUniqueOrThrow({ where: { id: result.changeId }, include: CHANGE_INCLUDE });
  // A STANDARD change that could not be pre-approved (freeze window, missing plan/window) stays a draft:
  // it exists (201), `meta` says why it is not approved.
  return ok(serializeChange(change), {
    status: 201,
    meta: { template_id: template.id, pre_approved: result.preApproved, ...(result.approvalError && { approval_error: result.approvalError }) },
  });
}

/** Ids in the body that point at nothing, as API field errors (a 422 instead of a failed foreign key). */
async function unknownReferences(body: ChangeCreate): Promise<Record<string, string[]> | null> {
  const errors: Record<string, string[]> = {};
  if (body.assignee_id && !(await db.user.findFirst({ where: { id: body.assignee_id, isActive: true }, select: { id: true } }))) {
    errors.assignee_id = [`Unknown or inactive user: ${body.assignee_id}`];
  }
  if (body.group_id && !(await db.group.findUnique({ where: { id: body.group_id }, select: { id: true } }))) {
    errors.group_id = [`Unknown group: ${body.group_id}`];
  }
  if (body.category_id && !(await db.category.findUnique({ where: { id: body.category_id }, select: { id: true } }))) {
    errors.category_id = [`Unknown category: ${body.category_id}`];
  }
  const assetIds = [...new Set(body.asset_ids ?? [])];
  if (assetIds.length && (await db.asset.count({ where: { id: { in: assetIds } } })) !== assetIds.length) {
    errors.asset_ids = ["One of the affected configuration items does not exist."];
  }
  return Object.keys(errors).length > 0 ? errors : null;
}
