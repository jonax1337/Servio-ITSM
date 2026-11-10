import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveAccountFlags, serviceAccountApprovalChange, type ServiceAccountApprovalChange } from "@/lib/service-accounts";

/**
 * Writes the account-type flags of a person (service account, may approve changes) for both edit paths,
 * the People dialog and PATCH /api/v1/users/{id}. Server-only (Prisma).
 *
 * Changing a flag never touches an approval that is already in progress: seats on changes in APPROVAL stay
 * as they are, nothing is approved, rejected or removed (see docs/modules.md, "Service accounts"). The
 * number of such seats is returned so the audit entry can say how many are left for a manager to handle.
 */

type Client = Prisma.TransactionClient;

export type AccountFlagsChange =
  | { ok: true; changed: string[]; openSeats: number; serviceAccountApproval: ServiceAccountApprovalChange }
  | { ok: false; error: string };

export async function applyAccountFlags(
  userId: string,
  next: { isServiceAccount?: boolean; canApproveChanges?: boolean },
  actorRole: string | null | undefined,
  client: Client = db,
): Promise<AccountFlagsChange> {
  const unchanged: AccountFlagsChange = { ok: true, changed: [], openSeats: 0, serviceAccountApproval: null };
  if (next.isServiceAccount === undefined && next.canApproveChanges === undefined) return unchanged;
  const current = await client.user.findUniqueOrThrow({
    where: { id: userId },
    select: { isServiceAccount: true, canApproveChanges: true },
  });
  const flags = resolveAccountFlags(current, next, actorRole);
  if (!flags.ok) return flags;
  const changed = [
    ...(flags.isServiceAccount !== current.isServiceAccount ? ["isServiceAccount"] : []),
    ...(flags.canApproveChanges !== current.canApproveChanges ? ["canApproveChanges"] : []),
  ];
  if (changed.length === 0) return unchanged;
  await client.user.update({ where: { id: userId }, data: { isServiceAccount: flags.isServiceAccount, canApproveChanges: flags.canApproveChanges } });
  // A service account does not belong on a board of other people's changes, so its seats count as open too.
  const openSeats = flags.canApproveChanges && !flags.isServiceAccount
    ? 0
    : await client.changeApproval.count({ where: { approverId: userId, status: "PENDING", change: { status: "APPROVAL" } } });
  return { ok: true, changed, openSeats, serviceAccountApproval: serviceAccountApprovalChange(current, flags) };
}
