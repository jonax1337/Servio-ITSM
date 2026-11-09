import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveAccountFlags } from "@/lib/service-accounts";

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
  | { ok: true; changed: string[]; openSeats: number }
  | { ok: false; error: string };

export async function applyAccountFlags(
  userId: string,
  next: { isServiceAccount?: boolean; canApproveChanges?: boolean },
  client: Client = db,
): Promise<AccountFlagsChange> {
  if (next.isServiceAccount === undefined && next.canApproveChanges === undefined) return { ok: true, changed: [], openSeats: 0 };
  const current = await client.user.findUniqueOrThrow({
    where: { id: userId },
    select: { isServiceAccount: true, canApproveChanges: true },
  });
  const flags = resolveAccountFlags(current, next);
  if (!flags.ok) return flags;
  const changed = [
    ...(flags.isServiceAccount !== current.isServiceAccount ? ["isServiceAccount"] : []),
    ...(flags.canApproveChanges !== current.canApproveChanges ? ["canApproveChanges"] : []),
  ];
  if (changed.length === 0) return { ok: true, changed, openSeats: 0 };
  await client.user.update({ where: { id: userId }, data: { isServiceAccount: flags.isServiceAccount, canApproveChanges: flags.canApproveChanges } });
  const openSeats = flags.canApproveChanges
    ? 0
    : await client.changeApproval.count({ where: { approverId: userId, status: "PENDING", change: { status: "APPROVAL" } } });
  return { ok: true, changed, openSeats };
}
