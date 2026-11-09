import { z } from "zod";
import { externalRefSchema } from "@/lib/ticket-external-ref";
import {
  CATALOG_TICKET_TYPES,
  FIELD_TYPES,
  MAX_APPROVAL_STAGES,
  MAX_FORM_FIELDS,
  MAX_TITLE_LEN,
  formSchemaProblems,
  parseApprovalStages,
  parseFormSchema,
  type ServiceField,
} from "@/lib/service-forms";

/**
 * Request bodies of the /api/v1/catalog-items endpoints (snake_case, strict) and
 * the pure helpers the handlers share. The question schema is also what the
 * console's catalog editor is checked against, so a form saved either way has
 * the same shape. Shared with the OpenAPI route.
 */

/** A question key: what answers are stored under and what title placeholders and conditions name. */
export const QUESTION_KEY_RE = /^[A-Za-z0-9_-]{1,100}$/;
const QUESTION_KEY_HINT = "Question keys are 1-100 characters: letters, digits, _ or -";

/**
 * An option or condition answer. `,` `;` and line breaks are refused because stored answers
 * are joined with them (multiple choice, ticket text), which would split one choice into two.
 */
const answer = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((v) => !/[,;\r\n]/.test(v), { message: "Options and answers cannot contain commas, semicolons or line breaks" });

export const catalogConditionSchema = z.strictObject({
  /** Key of an EARLIER select, multiselect, checkbox or urgency question. */
  field: z.string().regex(QUESTION_KEY_RE, QUESTION_KEY_HINT),
  /** Answers that show the question: options of the question, LOW/MEDIUM/HIGH for urgency, "true"/"false" for a checkbox. */
  values: z.array(answer).min(1, "Choose at least one answer that shows the question").max(100),
});

export const catalogQuestionSchema = z.strictObject({
  key: z.string().regex(QUESTION_KEY_RE, QUESTION_KEY_HINT),
  label: z.string().trim().min(1, "Every question needs a label").max(300),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  /** Choices of a select or multiselect question. */
  options: z.array(answer).max(100).optional(),
  placeholder: z.string().trim().max(300).optional(),
  help: z.string().trim().max(1000).optional(),
  /** Show (and only then require) the question when an earlier question has one of the given answers; null = always. */
  condition: catalogConditionSchema.nullable().optional(),
});

/** An ordered form: keys unique, conditions pointing at earlier choice questions (see formSchemaProblems). */
export const catalogQuestionsSchema = z
  .array(catalogQuestionSchema)
  .max(MAX_FORM_FIELDS)
  .superRefine((questions, ctx) => {
    for (const message of formSchemaProblems(questions as ServiceField[])) ctx.addIssue({ code: "custom", message });
  });

export type CatalogQuestion = z.infer<typeof catalogQuestionSchema>;

/** A stage names exactly one approver OR one group. */
export const approvalStageSchema = z
  .strictObject({ approver_id: z.string().min(1).optional(), group_id: z.string().min(1).optional() })
  .refine((s) => Boolean(s.approver_id) !== Boolean(s.group_id), { message: "A stage names either approver_id or group_id" });

const fields = {
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(200),
  description: z.string().trim().max(20_000).nullable(),
  short_description: z.string().trim().max(300).nullable(),
  /** A lucide icon name, as in the console's icon picker. */
  icon: z.string().trim().max(60).nullable(),
  category_id: z.string().min(1).nullable(),
  /** The service the request maps to (SLA, routing, reporting). */
  service_id: z.string().min(1).nullable(),
  /** Team requests are routed to; null = the service's team, else the category's, else the triage team. */
  group_id: z.string().min(1).nullable(),
  ticket_type: z.enum(CATALOG_TICKET_TYPES),
  /** Ticket title with {{item}}, {{requester}} and {{<question key>}}; null = "<Item> request". */
  title_template: z.string().trim().max(MAX_TITLE_LEN).nullable(),
  estimated_days: z.number().int().min(0).max(3650).nullable(),
  published: z.boolean(),
  /** Position in the catalog (ascending). */
  order: z.number().int().min(0).max(1_000_000),
  requires_approval: z.boolean(),
  /** Single approver (an active agent); ignored for routing when approval_stages are set. */
  approver_id: z.string().min(1).nullable(),
  approval_stages: z.array(approvalStageSchema).max(MAX_APPROVAL_STAGES),
  questions: catalogQuestionsSchema,
  /** Groups whose members may see and request the item; [] = visible to everyone (restriction lifted). Replaces the set. */
  visible_to_group_ids: z.array(z.string().min(1)).max(100),
};

type Fields = typeof fields;
const allOptional = Object.fromEntries(Object.entries(fields).map(([k, s]) => [k, s.optional()])) as {
  [K in keyof Fields]: z.ZodOptional<Fields[K]>;
};

export const catalogItemCreateSchema = z.strictObject({
  ...allOptional,
  name: fields.name,
  /** Origin key for a script-maintained item; PUT /catalog-items/ref/{ref} upserts by it. */
  import_ref: externalRefSchema.optional(),
});

export const catalogItemPatchSchema = z
  .strictObject({ ...allOptional, import_ref: externalRefSchema.nullable().optional() })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

/** PUT /catalog-items/ref/{ref}: the fields to set; `name` is required only when the item is new. */
export const catalogItemUpsertSchema = z.strictObject(allOptional);

export type CatalogItemPatch = z.infer<typeof catalogItemPatchSchema>;
export type CatalogItemUpsert = z.infer<typeof catalogItemUpsertSchema>;

/** The stored question JSON (the fields that are set, in a fixed key order). */
export function questionsJson(questions: CatalogQuestion[]): string {
  return JSON.stringify(
    questions.map((q) => ({
      key: q.key,
      label: q.label,
      type: q.type,
      ...(q.required !== undefined && { required: q.required }),
      ...(q.options !== undefined && { options: q.options }),
      ...(q.placeholder && { placeholder: q.placeholder }),
      ...(q.help && { help: q.help }),
      ...(q.condition && { condition: { field: q.condition.field, values: q.condition.values } }),
    })),
  );
}

/** The stored approval-stage JSON, or null for none (single-approver items). */
export function stagesJson(stages: z.infer<typeof approvalStageSchema>[]): string | null {
  const clean = stages.map((s) => (s.approver_id ? { approverId: s.approver_id } : { groupId: s.group_id! }));
  return clean.length ? JSON.stringify(clean) : null;
}

/** The Prisma columns for the fields present in a body (absent keys stay untouched). */
export function catalogItemData(b: Partial<CatalogItemPatch>) {
  const blank = (v: string | null) => (v ? v : null);
  return {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.description !== undefined && { description: blank(b.description) }),
    ...(b.short_description !== undefined && { shortDescription: blank(b.short_description) }),
    ...(b.icon !== undefined && { icon: blank(b.icon) }),
    ...(b.category_id !== undefined && { categoryId: b.category_id }),
    ...(b.service_id !== undefined && { serviceId: b.service_id }),
    ...(b.group_id !== undefined && { groupId: b.group_id }),
    ...(b.ticket_type !== undefined && { ticketType: b.ticket_type }),
    ...(b.title_template !== undefined && { titleTemplate: blank(b.title_template) }),
    ...(b.estimated_days !== undefined && { estimatedDays: b.estimated_days }),
    ...(b.published !== undefined && { isPublished: b.published }),
    ...(b.order !== undefined && { order: b.order }),
    ...(b.requires_approval !== undefined && { requiresApproval: b.requires_approval }),
    ...(b.approver_id !== undefined && { approverId: b.approver_id }),
    ...(b.approval_stages !== undefined && { approvalStages: stagesJson(b.approval_stages) }),
    ...(b.questions !== undefined && { formSchema: questionsJson(b.questions) }),
    ...(b.import_ref !== undefined && { importRef: b.import_ref }),
  };
}

export type CatalogItemRow = {
  id: string; name: string; description: string | null; shortDescription: string | null; icon: string | null;
  categoryId: string | null; serviceId: string | null; groupId: string | null; ticketType: string; titleTemplate: string | null;
  estimatedDays: number | null; isPublished: boolean; order: number; requiresApproval: boolean; approverId: string | null;
  approvalStages: string | null; formSchema: string; importRef: string | null; createdAt: Date; updatedAt: Date;
  restrictToGroups: boolean; visibleTo: { groupId: string }[];
};

/** Load an item with the groups it is restricted to (what `CatalogItemRow` needs). */
export const CATALOG_ITEM_INCLUDE = { visibleTo: { select: { groupId: true } } } as const;

/** The group ids, in a stable order (the order they are stored in is not meaningful). */
export function visibleGroupIdsOf(c: Pick<CatalogItemRow, "visibleTo">): string[] {
  return c.visibleTo.map((g) => g.groupId).sort();
}

/** A question as the API returns it (the stored shape is already snake_case-safe). */
function serializeQuestion(f: ServiceField) {
  return {
    key: f.key,
    label: f.label,
    type: f.type,
    required: !!f.required,
    ...(f.options !== undefined && { options: f.options }),
    ...(f.placeholder && { placeholder: f.placeholder }),
    ...(f.help && { help: f.help }),
    condition: f.condition ? { field: f.condition.field, values: f.condition.values } : null,
  };
}

export function serializeCatalogItem(c: CatalogItemRow) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    short_description: c.shortDescription,
    icon: c.icon,
    category_id: c.categoryId,
    service_id: c.serviceId,
    group_id: c.groupId,
    ticket_type: c.ticketType,
    title_template: c.titleTemplate,
    estimated_days: c.estimatedDays,
    published: c.isPublished,
    order: c.order,
    requires_approval: c.requiresApproval,
    approver_id: c.approverId,
    approval_stages: parseApprovalStages(c.approvalStages).map((s) => (s.approverId ? { approver_id: s.approverId } : { group_id: s.groupId })),
    questions: parseFormSchema(c.formSchema).map(serializeQuestion),
    visible_to_group_ids: visibleGroupIdsOf(c),
    // true = only members of visible_to_group_ids see it; restricted with no group left (all deleted) = visible to nobody
    restricted: c.restrictToGroups,
    import_ref: c.importRef,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

/** Columns whose API field is not simply their snake_case name. */
export const CATALOG_FIELD_RENAMES: Record<string, string> = { formSchema: "questions", isPublished: "published" };
