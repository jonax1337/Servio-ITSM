import { z } from "zod";
import { MAX_SECONDARY_EMAILS } from "@/lib/user-email-rules";

/**
 * Request body of PATCH /api/v1/users/{id} (snake_case, strict: unknown fields
 * are a 422, at least one field is required). Shared with the OpenAPI route.
 * `secondary_emails` REPLACES the person's secondary addresses; send `[]` to remove
 * them all. Address shape, the primary address and uniqueness are checked by the
 * handler. `service_account` marks a non-human account (no email, never on the approval
 * board of other people's changes; marking it also turns `can_approve_changes` off,
 * unmarking turns it on); `can_approve_changes` is the per-account switch for approving
 * changes. Turning it on for a service account is deliberate and needs an ADMIN owner.
 */
export const userPatchSchema = z
  .strictObject({
    secondary_emails: z.array(z.string().trim().min(1).max(254)).max(MAX_SECONDARY_EMAILS).optional(),
    service_account: z.boolean().optional(),
    can_approve_changes: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

export type UserPatch = z.infer<typeof userPatchSchema>;
