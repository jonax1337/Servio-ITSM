import type { Prisma } from "@prisma/client";

/** The user fields the REST API exposes (minimal: enough to resolve ids and match mail senders). */
export const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  secondaryEmails: { select: { email: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.UserSelect;

type UserRow = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

export function serializeUser(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    secondary_emails: u.secondaryEmails.map((e) => e.email),
    role: u.role,
    active: u.isActive,
  };
}
