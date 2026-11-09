import type { Adapter } from "next-auth/adapters";
import { writeAudit } from "@/lib/audit";
import { emailOwnerId } from "@/lib/user-emails";

/**
 * The Auth.js adapter, except that it will not create a user whose email is
 * already some person's address. The database only keeps `User.email` unique on
 * its own, so a first SSO sign-in could otherwise mint a second account whose
 * primary address is another person's SECONDARY one (see lib/user-emails.ts).
 * Refusing makes the sign-in fail; an admin links the identity to the existing
 * account instead.
 */
export function guardAdapter(base: Adapter): Adapter {
  return {
    ...base,
    async createUser(data) {
      const ownerId = data.email ? await emailOwnerId(data.email) : null;
      if (ownerId) {
        console.warn(`[auth] SSO sign-in refused: ${data.email} already belongs to another account`);
        await writeAudit({
          userId: ownerId,
          action: "LOGIN_FAILED",
          entity: "User",
          entityId: ownerId,
          summary: `SSO sign-up refused: ${data.email} is already an address of this account`,
        });
        throw new Error("EmailInUse");
      }
      return base.createUser!(data);
    },
  };
}
