import { z } from "zod";
import { AUTO_ASSIGN_STRATEGIES, GROUP_MEMBER_ROLES, GROUP_TYPES } from "@/lib/constants";
import { EXTERNAL_REF_HINT, EXTERNAL_REF_RE } from "@/lib/ticket-external-ref";

/** Request body of POST /api/v1/groups/{id}/members (snake_case, unknown fields are a 422). Shared with the OpenAPI route. */
export const groupMemberAddSchema = z.strictObject({
  user_id: z.string().trim().min(1),
  /** Only used when the membership is created; an existing membership is left as it is. */
  role: z.enum(GROUP_MEMBER_ROLES).optional(),
});

export type GroupMemberAdd = z.infer<typeof groupMemberAddSchema>;

/**
 * Request bodies of POST /api/v1/groups, PATCH /api/v1/groups/{id} and PUT /api/v1/groups/ref/{ref}
 * (snake_case and strict, like the other management endpoints: an unknown field is a 422). Pure and
 * DB-free, so the contract is unit-testable; shared with the OpenAPI route.
 */
const ref = z.string().regex(EXTERNAL_REF_RE, EXTERNAL_REF_HINT);

const groupFields = {
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  /** null clears it. */
  description: z.string().trim().max(2000).nullable(),
  type: z.enum(GROUP_TYPES),
  /** The group's shared mailbox; null clears it. */
  email: z.string().trim().max(254).pipe(z.email()).nullable(),
  /** Hex colour, e.g. #6366f1. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #6366f1"),
  /** The team lead shown on the group: an active agent (AGENT, MANAGER, ADMIN). null clears it. */
  manager_id: z.string().min(1).nullable(),
  auto_assign: z.enum(AUTO_ASSIGN_STRATEGIES),
};

const optionalFields = Object.fromEntries(Object.entries(groupFields).map(([k, s]) => [k, s.optional()])) as {
  [K in keyof typeof groupFields]: z.ZodOptional<(typeof groupFields)[K]>;
};

export const groupCreateSchema = z.strictObject({
  ...optionalFields,
  name: groupFields.name,
  /** Origin key for later upserts through PUT /groups/ref/{ref}. */
  import_ref: ref.optional(),
});

export const groupPatchSchema = z
  .strictObject({
    ...optionalFields,
    /** Adopts an existing group into the reference scheme; null releases the reference. */
    import_ref: ref.nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

/** Body of PUT /groups/ref/{ref}: `name` is required when the reference is new; on an existing group only the fields sent are written. */
export const groupUpsertSchema = z
  .strictObject(optionalFields)
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to write" });

export type GroupCreate = z.infer<typeof groupCreateSchema>;
export type GroupPatch = z.infer<typeof groupPatchSchema>;
export type GroupUpsert = z.infer<typeof groupUpsertSchema>;

/** The scalar columns a body sets, as Prisma data. Absent keys stay untouched. */
export function groupData(b: Partial<GroupPatch>) {
  return {
    ...(b.name !== undefined && { name: b.name }),
    ...(b.description !== undefined && { description: b.description || null }),
    ...(b.type !== undefined && { type: b.type }),
    ...(b.email !== undefined && { email: b.email || null }),
    ...(b.color !== undefined && { color: b.color }),
    ...(b.manager_id !== undefined && { managerId: b.manager_id }),
    ...(b.auto_assign !== undefined && { autoAssign: b.auto_assign }),
    ...(b.import_ref !== undefined && { importRef: b.import_ref }),
  };
}
