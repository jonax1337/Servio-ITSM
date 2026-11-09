import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { normalizeEmail } from "@/lib/person-rules";

/**
 * A person's addresses: the primary `User.email` (sign-in, notifications) plus
 * any number of secondary `UserEmail` rows (recognised on inbound mail). An
 * address belongs to at most one person across BOTH tables; the database only
 * enforces each table on its own, so every write goes through these helpers.
 *
 * Server-only (Prisma).
 */

export const EMAIL_TAKEN = "A person with this email already exists.";

/** A client to run the lookups on: the shared one, or the transaction a caller is inside (it must stay on its own connection). */
type Client = Prisma.TransactionClient;

/** The id of the person who owns `email` as primary or secondary address, or null. */
export async function emailOwnerId(email: string, client: Client = db): Promise<string | null> {
  const address = normalizeEmail(email);
  if (!address) return null;
  const primary = await client.user.findUnique({ where: { email: address }, select: { id: true } });
  if (primary) return primary.id;
  const secondary = await client.userEmail.findUnique({ where: { email: address }, select: { userId: true } });
  return secondary?.userId ?? null;
}

/** True when `email` is used by anyone other than `exceptUserId` (primary or secondary). */
export async function emailTakenByOther(email: string, exceptUserId?: string, client: Client = db): Promise<boolean> {
  const owner = await emailOwnerId(email, client);
  return owner !== null && owner !== exceptUserId;
}

/** Find a person by any of their addresses (primary first). */
export async function findUserByAnyEmail<S extends Prisma.UserSelect>(email: string, select: S) {
  const address = normalizeEmail(email);
  if (!address) return null;
  const primary = await db.user.findUnique({ where: { email: address }, select });
  if (primary) return primary;
  const secondary = await db.userEmail.findUnique({ where: { email: address }, select: { userId: true } });
  return secondary ? db.user.findUnique({ where: { id: secondary.userId }, select }) : null;
}

/** A where-clause matching people by any address — for lookups that list users. */
export function anyEmailContains(fragment: string): Prisma.UserWhereInput[] {
  const q = fragment.toLowerCase();
  return [{ email: { contains: q } }, { secondaryEmails: { some: { email: { contains: q } } } }];
}

export async function listSecondaryEmails(userId: string, client: Client = db): Promise<string[]> {
  const rows = await client.userEmail.findMany({ where: { userId }, orderBy: { createdAt: "asc" }, select: { email: true } });
  return rows.map((r) => r.email);
}

/**
 * Replace a person's secondary addresses with `emails` (already normalized via
 * normalizeSecondaryEmails). Refuses an address another person uses as primary
 * or secondary.
 *
 * Pass `tx` to make the change part of the caller's interactive transaction (a
 * profile edit saves the primary address and the secondary ones together);
 * without it the helper opens a small transaction of its own. Returns the addresses added and removed for the audit entry.
 */
export async function replaceSecondaryEmails(
  userId: string,
  emails: string[],
  tx?: Client,
): Promise<{ ok: true; added: string[]; removed: string[] } | { ok: false; error: string; email: string }> {
  const client = tx ?? db;
  for (const email of emails) {
    if (await emailTakenByOther(email, userId, client)) return { ok: false, error: EMAIL_TAKEN, email };
  }
  const current = await listSecondaryEmails(userId, client);
  const added = emails.filter((e) => !current.includes(e));
  const removed = current.filter((e) => !emails.includes(e));
  if (added.length || removed.length) {
    if (tx) {
      await tx.userEmail.deleteMany({ where: { userId, email: { in: removed } } });
      for (const email of added) await tx.userEmail.create({ data: { userId, email } });
    } else {
      await db.$transaction([
        db.userEmail.deleteMany({ where: { userId, email: { in: removed } } }),
        ...added.map((email) => db.userEmail.create({ data: { userId, email } })),
      ]);
    }
  }
  return { ok: true, added, removed };
}

/**
 * Promoting one of a person's secondary addresses to primary: drop the
 * secondary row so the address stays unique. Call before writing User.email.
 */
export async function releaseOwnSecondary(userId: string, email: string): Promise<void> {
  await db.userEmail.deleteMany({ where: { userId, email: normalizeEmail(email) } });
}
