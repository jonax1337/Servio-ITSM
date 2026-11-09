"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAgentUser, requireManagerUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import type { ActionResult } from "@/lib/action-result";
import { createChangeFromTemplate } from "@/lib/change-templates";
import { distinctIds } from "@/lib/utils";
import { standardTemplateApprovalProblem, templateProblem, type TemplateApprovalState } from "@/lib/change-template-rules";
import { approverRolesForRisk } from "@/lib/cab";
import { CHANGE_TEMPLATE_TYPES, IMPACT_URGENCY, PRIORITIES, RISKS } from "@/lib/constants";

export type TemplateActionState =
  | {
      error?: string;
      fieldErrors?: Record<string, string[]>;
      saved?: boolean;
      /** Set when a change was created but its pre-approval was refused; it waits as a draft. */
      draftChangeId?: number;
    }
  | undefined;

const NOT_AUTHORISED = "Not authorised";
const PLANS_FIELD_ERRORS = (message: string) => ({ implementationPlan: [message], rollbackPlan: [message] });

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" ? v : null));

const optionalText = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

const templateSchema = z.object({
  name: z.string().trim().min(3, "Name must be at least 3 characters").max(80),
  summary: optionalText,
  isActive: z.string().optional().transform((v) => v === "on"),
  type: z.enum(CHANGE_TEMPLATE_TYPES),
  title: z.string().trim().min(3, "Title must be at least 3 characters"),
  description: z.string().default(""),
  reason: optionalText,
  implementationPlan: optionalText,
  rollbackPlan: optionalText,
  risk: z.enum(RISKS),
  priority: z.enum(PRIORITIES),
  impact: z.enum(IMPACT_URGENCY),
  categoryId: optionalId,
  serviceId: optionalId,
  groupId: optionalId,
});

type TemplateData = z.infer<typeof templateSchema>;

type Parsed = { data: TemplateData } | { state: NonNullable<TemplateActionState> };

/** Error for the first of the template's category, service or team that no longer exists, or null. */
async function missingReference(t: Pick<TemplateData, "categoryId" | "serviceId" | "groupId">): Promise<string | null> {
  const [category, service, group] = await Promise.all([
    t.categoryId ? db.category.findUnique({ where: { id: t.categoryId }, select: { id: true } }) : true,
    t.serviceId ? db.service.findUnique({ where: { id: t.serviceId }, select: { id: true } }) : true,
    t.groupId ? db.group.findUnique({ where: { id: t.groupId }, select: { id: true } }) : true,
  ]);
  if (!category) return "Category not found.";
  if (!service) return "Service not found.";
  if (!group) return "Team not found.";
  return null;
}

async function parseTemplate(formData: FormData): Promise<Parsed> {
  const parsed = templateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { state: { error: "Please fix the errors below.", fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  const problem = templateProblem(parsed.data);
  if (problem) return { state: { error: "Please fix the errors below.", fieldErrors: PLANS_FIELD_ERRORS(problem) } };
  const missing = await missingReference(parsed.data);
  if (missing) return { state: { error: missing } };
  return { data: parsed.data };
}

/** Refusal state when `role` may not save the resulting active STANDARD (pre-approved) template. */
function approvalRefusal(role: string, current: TemplateApprovalState | null, data: TemplateData): TemplateActionState {
  const refusal = standardTemplateApprovalProblem(role, current, data, approverRolesForRisk);
  return refusal ? { error: refusal } : undefined;
}

const DUPLICATE_NAME_STATE = { error: "Please fix the errors below.", fieldErrors: { name: ["A template with this name already exists."] } };

const isDuplicateName = (e: unknown) => (e as { code?: string })?.code === "P2002";

export async function createChangeTemplate(_prev: TemplateActionState, formData: FormData): Promise<TemplateActionState> {
  const me = await requireManagerUser();
  if (!me) return { error: NOT_AUTHORISED };
  const parsed = await parseTemplate(formData);
  if ("state" in parsed) return parsed.state;
  const refused = approvalRefusal(me.role, null, parsed.data);
  if (refused) return refused;

  try {
    const template = await db.changeTemplate.create({ data: parsed.data, select: { id: true, name: true } });
    await writeAudit({ userId: me.id, action: "CREATE", entity: "ChangeTemplate", entityId: template.id, summary: `Created change template "${template.name}"` });
  } catch (e) {
    if (isDuplicateName(e)) return DUPLICATE_NAME_STATE;
    throw e;
  }
  revalidatePath("/changes/templates");
  redirect("/changes/templates");
}

export async function updateChangeTemplate(_prev: TemplateActionState, formData: FormData): Promise<TemplateActionState> {
  const me = await requireManagerUser();
  if (!me) return { error: NOT_AUTHORISED };
  const id = z.string().min(1).safeParse(formData.get("id"));
  if (!id.success) return { error: "Invalid request." };
  const parsed = await parseTemplate(formData);
  if ("state" in parsed) return parsed.state;
  const current = await db.changeTemplate.findUnique({ where: { id: id.data } });
  if (!current) return { error: "Template not found." };
  const refused = approvalRefusal(me.role, current, parsed.data);
  if (refused) return refused;

  try {
    await db.changeTemplate.update({ where: { id: id.data }, data: parsed.data });
  } catch (e) {
    if (isDuplicateName(e)) return DUPLICATE_NAME_STATE;
    if ((e as { code?: string })?.code === "P2025") return { error: "Template not found." };
    throw e;
  }
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "ChangeTemplate", entityId: id.data, summary: `Updated change template "${parsed.data.name}"` });
  revalidatePath("/changes/templates");
  revalidatePath(`/changes/templates/${id.data}`);
  return { saved: true };
}

export async function deleteChangeTemplate(formData: FormData): Promise<ActionResult> {
  const me = await requireManagerUser();
  if (!me) return { ok: false, error: NOT_AUTHORISED };
  const id = z.string().min(1).safeParse(formData.get("id"));
  if (!id.success) return { ok: false, error: "Invalid request." };

  const template = await db.changeTemplate.findUnique({ where: { id: id.data }, select: { name: true } });
  if (!template) return { ok: false, error: "Template not found." };
  await db.changeTemplate.delete({ where: { id: id.data } });
  await writeAudit({ userId: me.id, action: "DELETE", entity: "ChangeTemplate", entityId: id.data, summary: `Deleted change template "${template.name}"` });
  revalidatePath("/changes/templates");
  redirect("/changes/templates");
}

// ── Creating a change from a template ────────────────────────────────────────

/** An absent key keeps the template's value; present-but-blank clears an optional one. */
const idOverride = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : v && v !== "none" ? v : null));

const dateOverride = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? new Date(v) : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), "Enter a valid date.");

const fromTemplateSchema = z.object({
  templateId: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  reason: z.string().optional(),
  implementationPlan: z.string().optional(),
  rollbackPlan: z.string().optional(),
  risk: z.enum(RISKS).optional(),
  priority: z.enum(PRIORITIES).optional(),
  impact: z.enum(IMPACT_URGENCY).optional(),
  assigneeId: idOverride,
  groupId: idOverride,
  categoryId: idOverride,
  plannedStart: dateOverride,
  plannedEnd: dateOverride,
});

const CUSTOM_FIELD_PREFIX = "cf_";

export async function createChangeFromTemplateAction(_prev: TemplateActionState, formData: FormData): Promise<TemplateActionState> {
  const me = await requireAgentUser();
  if (!me) return { error: NOT_AUTHORISED };

  const parsed = fromTemplateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const { templateId, ...overrides } = parsed.data;

  const customFields: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith(CUSTOM_FIELD_PREFIX) && typeof value === "string") customFields[key.slice(CUSTOM_FIELD_PREFIX.length)] = value;
  }

  const result = await createChangeFromTemplate(me.id, templateId, overrides, customFields, distinctIds(formData.getAll("assetIds")));
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  // Stay on the form so the refusal reason is read, not lost in the redirect.
  if (result.approvalError) return { error: result.approvalError, draftChangeId: result.changeId };
  redirect(`/changes/${result.changeId}`);
}
