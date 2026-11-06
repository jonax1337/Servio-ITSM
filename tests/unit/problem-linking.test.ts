import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { linkTicketsToProblem, NothingToLink } from "@/lib/problem-linking";

function fakeTx(claimedCount: number, linkedIds: number[]) {
  const updateMany = vi.fn().mockResolvedValue({ count: claimedCount });
  const findMany = vi.fn().mockResolvedValue(linkedIds.map((id) => ({ id })));
  return { tx: { ticket: { updateMany, findMany } } as unknown as Prisma.TransactionClient, updateMany, findMany };
}

describe("linkTicketsToProblem", () => {
  it("claims only candidates that still have no problem and returns the ids really linked", async () => {
    const { tx, updateMany, findMany } = fakeTx(2, [4, 9]);

    await expect(linkTicketsToProblem(tx, 7, [4, 9, 12])).resolves.toEqual([4, 9]);

    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: [4, 9, 12] }, problemId: null }, data: { problemId: 7 } });
    expect(findMany).toHaveBeenCalledWith({ where: { problemId: 7 }, select: { id: true } });
  });

  it("throws NothingToLink when every candidate was taken meanwhile, so the transaction rolls back", async () => {
    const { tx, findMany } = fakeTx(0, []);

    await expect(linkTicketsToProblem(tx, 7, [4, 9])).rejects.toBeInstanceOf(NothingToLink);
    expect(findMany).not.toHaveBeenCalled();
  });
});
