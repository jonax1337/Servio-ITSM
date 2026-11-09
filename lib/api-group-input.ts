import { z } from "zod";
import { GROUP_MEMBER_ROLES } from "@/lib/constants";

/** Request body of POST /api/v1/groups/{id}/members (snake_case, unknown fields are a 422). Shared with the OpenAPI route. */
export const groupMemberAddSchema = z.strictObject({
  user_id: z.string().trim().min(1),
  /** Only used when the membership is created; an existing membership is left as it is. */
  role: z.enum(GROUP_MEMBER_ROLES).optional(),
});

export type GroupMemberAdd = z.infer<typeof groupMemberAddSchema>;
