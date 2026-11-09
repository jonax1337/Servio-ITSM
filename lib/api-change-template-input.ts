import { z } from "zod";
import { CHANGE_TEMPLATE_TYPES, IMPACT_URGENCY, PRIORITIES, RISKS } from "@/lib/constants";
import { externalRefSchema } from "@/lib/ticket-external-ref";
import { templateProblem } from "@/lib/change-template-rules";

/**
 * Request bodies of the /api/v1/change-templates endpoints (standard change
 * models; snake_case, strict) and the pure helpers the handlers share. The
 * limits match the console's template form. Shared with the OpenAPI route.
 */

const plan = z.string().trim().max(20_000).nullable();

const fields = {
  name: z.string().trim().min(3, "Name must be at least 3 characters").max(80),
  /** When to use the template (shown in the picker). */
  summary: z.string().trim().max(2000).nullable(),
  /** Offered in the "new change from template" picker. */
  active: z.boolean(),
  /** STANDARD = pre-authorized (its changes skip the CAB; needs both plans), NORMAL = goes through approval. */
  type: z.enum(CHANGE_TEMPLATE_TYPES),
  /** Prefilled change title. */
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(200),
  /** Prefilled change description (plain text). */
  description: z.string().max(20_000),
  reason: plan,
  implementation_plan: plan,
  rollback_plan: plan,
  risk: z.enum(RISKS),
  priority: z.enum(PRIORITIES),
  impact: z.enum(IMPACT_URGENCY),
  category_id: z.string().min(1).nullable(),
  /** Scopes the template in the picker (changes themselves carry no service). */
  service_id: z.string().min(1).nullable(),
  group_id: z.string().min(1).nullable(),
};

type Fields = typeof fields;
const allOptional = Object.fromEntries(Object.entries(fields).map(([k, s]) => [k, s.optional()])) as {
  [K in keyof Fields]: z.ZodOptional<Fields[K]>;
};

export const changeTemplateCreateSchema = z.strictObject({
  ...allOptional,
  name: fields.name,
  title: fields.title,
  /** Required: it decides whether the template's changes skip the CAB. */
  type: fields.type,
  /** Origin key for a script-maintained template; PUT /change-templates/ref/{ref} upserts by it. */
  import_ref: externalRefSchema.optional(),
});

export const changeTemplatePatchSchema = z
  .strictObject({ ...allOptional, import_ref: externalRefSchema.nullable().optional() })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

/** PUT /change-templates/ref/{ref}: the fields to set; `name` and `title` are required only for a new template. */
export const changeTemplateUpsertSchema = z.strictObject(allOptional);

export type ChangeTemplatePatch = z.infer<typeof changeTemplatePatchSchema>;
export type ChangeTemplateUpsert = z.infer<typeof changeTemplateUpsertSchema>;

/** The Prisma columns for the fields present in a body (absent keys stay untouched). */
export function changeTemplateData(b: Partial<ChangeTemplatePatch>) {
  const blank = (v: string | null) => (v ? v : null);
  return {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.summary !== undefined && { summary: blank(b.summary) }),
    ...(b.active !== undefined && { isActive: b.active }),
    ...(b.type !== undefined && { type: b.type }),
    ...(b.title !== undefined && { title: b.title }),
    ...(b.description !== undefined && { description: b.description }),
    ...(b.reason !== undefined && { reason: blank(b.reason) }),
    ...(b.implementation_plan !== undefined && { implementationPlan: blank(b.implementation_plan) }),
    ...(b.rollback_plan !== undefined && { rollbackPlan: blank(b.rollback_plan) }),
    ...(b.risk !== undefined && { risk: b.risk }),
    ...(b.priority !== undefined && { priority: b.priority }),
    ...(b.impact !== undefined && { impact: b.impact }),
    ...(b.category_id !== undefined && { categoryId: b.category_id }),
    ...(b.service_id !== undefined && { serviceId: b.service_id }),
    ...(b.group_id !== undefined && { groupId: b.group_id }),
    ...(b.import_ref !== undefined && { importRef: b.import_ref }),
  };
}

/** Columns whose API field is not simply their snake_case name. */
export const CHANGE_TEMPLATE_FIELD_RENAMES: Record<string, string> = { isActive: "active" };

export type ChangeTemplateRow = {
  id: string; name: string; summary: string | null; isActive: boolean; type: string; title: string; description: string;
  reason: string | null; implementationPlan: string | null; rollbackPlan: string | null; risk: string; priority: string;
  impact: string; categoryId: string | null; serviceId: string | null; groupId: string | null; importRef: string | null;
  createdAt: Date; updatedAt: Date;
};

/**
 * Why the template that results from `data` on top of `current` cannot be saved
 * (a STANDARD template without both plans), as API field errors, or null.
 */
export function changeTemplateProblem(
  current: Pick<ChangeTemplateRow, "type" | "implementationPlan" | "rollbackPlan"> | null,
  data: ReturnType<typeof changeTemplateData>,
): Record<string, string[]> | null {
  const merged = {
    type: data.type ?? current?.type ?? "STANDARD",
    implementationPlan: data.implementationPlan !== undefined ? data.implementationPlan : (current?.implementationPlan ?? null),
    rollbackPlan: data.rollbackPlan !== undefined ? data.rollbackPlan : (current?.rollbackPlan ?? null),
  };
  const problem = templateProblem(merged);
  return problem ? { implementation_plan: [problem], rollback_plan: [problem] } : null;
}

export function serializeChangeTemplate(t: ChangeTemplateRow) {
  return {
    id: t.id,
    name: t.name,
    summary: t.summary,
    active: t.isActive,
    type: t.type,
    title: t.title,
    description: t.description,
    reason: t.reason,
    implementation_plan: t.implementationPlan,
    rollback_plan: t.rollbackPlan,
    risk: t.risk,
    priority: t.priority,
    impact: t.impact,
    category_id: t.categoryId,
    service_id: t.serviceId,
    group_id: t.groupId,
    import_ref: t.importRef,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  };
}
