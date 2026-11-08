import { z } from "zod";

/**
 * Request bodies of POST /api/v1/categories and PATCH /api/v1/categories/{id}
 * (snake_case, like the other ITSM endpoints). Shared with the OpenAPI route.
 */

const id = z.string().min(1);
const optionalText = z.string().trim().max(500).nullable().optional();

export const categoryCreateSchema = z.strictObject({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  description: optionalText,
  icon: z.string().trim().max(60).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #64748b").optional(),
  /** null = top level. */
  parent_id: id.nullable().optional(),
  /** The team that handles the category; the default group of tickets created through the API. */
  group_id: id.nullable().optional(),
  /** Staff-only: not offered in the self-service portal. */
  portal_hidden: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export const categoryPatchSchema = categoryCreateSchema
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

export type CategoryCreate = z.infer<typeof categoryCreateSchema>;
export type CategoryPatch = z.infer<typeof categoryPatchSchema>;

/** The Prisma data for the fields present in a body (absent keys stay untouched on update). */
export function categoryData(b: CategoryPatch) {
  return {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.description !== undefined && { description: b.description || null }),
    ...(b.icon !== undefined && { icon: b.icon || null }),
    ...(b.color !== undefined && { color: b.color }),
    ...(b.parent_id !== undefined && { parentId: b.parent_id }),
    ...(b.group_id !== undefined && { groupId: b.group_id }),
    ...(b.portal_hidden !== undefined && { portalHidden: b.portal_hidden }),
    ...(b.archived !== undefined && { archived: b.archived }),
  };
}
