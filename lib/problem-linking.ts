import type { Prisma } from "@prisma/client";

export const NONE_LINKABLE = "None of these tickets can be linked: they already belong to a problem, or are outside your groups.";

/** Thrown inside a transaction to roll a new problem back when another agent took every ticket first. */
export class NothingToLink extends Error {}

/**
 * Links the candidate tickets that still have no problem to `problemId` and returns the ids that were
 * really linked. Throws NothingToLink (rolling the surrounding transaction back) when none could be.
 */
export async function linkTicketsToProblem(
  tx: Prisma.TransactionClient,
  problemId: number,
  candidateIds: readonly number[],
): Promise<number[]> {
  const claimed = await tx.ticket.updateMany({ where: { id: { in: [...candidateIds] }, problemId: null }, data: { problemId } });
  if (claimed.count === 0) throw new NothingToLink();
  const linked = await tx.ticket.findMany({ where: { problemId }, select: { id: true } });
  return linked.map((t) => t.id);
}
