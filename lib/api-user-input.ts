import { z } from "zod";
import { MAX_SECONDARY_EMAILS } from "@/lib/user-email-rules";

/**
 * Request body of PATCH /api/v1/users/{id} (snake_case, strict: unknown fields
 * are a 422). Shared with the OpenAPI route. `secondary_emails` REPLACES the
 * person's secondary addresses; send `[]` to remove them all. Address shape,
 * the primary address and uniqueness are checked by the handler.
 */
export const userPatchSchema = z.strictObject({
  secondary_emails: z.array(z.string().trim().min(1).max(254)).max(MAX_SECONDARY_EMAILS),
});

export type UserPatch = z.infer<typeof userPatchSchema>;
