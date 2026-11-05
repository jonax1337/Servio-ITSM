import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { findOperation } from "@/lib/ai-operations/registry";
import { signOperation } from "@/lib/ai-proposal-signature";

/**
 * Durable decisions on Sable's approve-first proposals. A decision belongs to
 * ONE proposal: the tool call that made it, plus a signature of its operation and
 * parsed args (so a client cannot reuse a call id for different args). Asking for
 * the same change again in a later turn is a new tool call, hence a new proposal.
 * Approve claims the key first, so a proposal is applied at most once however
 * often it is clicked, in however many tabs.
 */

/**
 * What a reloaded chat needs to know about a proposal. "unconfirmed": an apply
 * started but its result was never recorded (the request died or the record
 * failed), so the change may or may not exist and the card must not offer Approve.
 */
export type ProposalDecision = { status: "applied" | "dismissed" | "unconfirmed"; summary?: string };

/** The parts of a proposal its decision key is built from. */
export type ProposalIdentity = { operationId: string; args: unknown; toolCallId?: string };

/** Attempts at recording a finished apply before giving up (a busy SQLite usually clears quickly). */
const MARK_ATTEMPTS = 3;

/** The identity of a proposal's content: its operation plus its args as the operation's schema parses them. */
function proposalSignature(operationId: string, args: unknown): string {
  const parsed = findOperation(operationId)?.input.safeParse(args ?? {});
  return signOperation(operationId, parsed?.success ? parsed.data : args);
}

/** The decision key of one proposal: its tool call plus its content signature. */
export function proposalKey(p: ProposalIdentity): string {
  const signature = proposalSignature(p.operationId, p.args);
  return p.toolCallId ? `call:${p.toolCallId}:${signature}` : `sig:${signature}`;
}

/** A won claim carries a token; a refused claim of an applied proposal carries the original result. */
export type Claim =
  | { claimed: true; claimId: string }
  | { claimed: false; reason: string; appliedSummary?: string };

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

const keyOf = (conversationId: string, key: string) => ({
  conversationId_proposalKey: { conversationId, proposalKey: key },
});

/** Take the right to apply a proposal. Refuses one that is applied or being applied. */
export async function claimProposal(conversationId: string, key: string, userId: string): Promise<Claim> {
  const claimId = randomUUID();
  try {
    await db.aiProposalDecision.create({
      data: { conversationId, proposalKey: key, status: "APPLYING", claimId, decidedById: userId },
    });
    return { claimed: true, claimId };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }

  const existing = await db.aiProposalDecision.findUnique({ where: keyOf(conversationId, key) });
  if (!existing) return claimProposal(conversationId, key, userId);
  if (existing.status === "APPLIED") {
    return { claimed: false, reason: "This proposal has already been applied.", appliedSummary: existing.summary ?? "Applied" };
  }

  // An APPLYING row is never retaken, even an old one: its request may have made
  // the change before dying, and applying again would duplicate it. Only a
  // dismissal can be overruled by approving after all.
  if (existing.status !== "DISMISSED") return { claimed: false, reason: "This proposal is already being applied." };

  // Conditional on the row being unchanged, so two concurrent approvals cannot both win.
  const { count } = await db.aiProposalDecision.updateMany({
    where: { id: existing.id, status: existing.status, updatedAt: existing.updatedAt },
    data: { status: "APPLYING", claimId, decidedById: userId },
  });
  return count === 1
    ? { claimed: true, claimId }
    : { claimed: false, reason: "This proposal is already being applied." };
}

/** Record that our claim was applied, with the operation's result line. Only our own claim is touched. */
export async function markProposalApplied(conversationId: string, key: string, claimId: string, summary: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.aiProposalDecision.updateMany({
        where: { conversationId, proposalKey: key, claimId, status: "APPLYING" },
        data: { status: "APPLIED", summary },
      });
      return;
    } catch (e) {
      if (attempt >= MARK_ATTEMPTS) throw e;
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
}

/** Give our claim back after the operation refused or failed, so the user can fix and retry. */
export async function releaseProposalClaim(conversationId: string, key: string, claimId: string) {
  await db.aiProposalDecision.deleteMany({ where: { conversationId, proposalKey: key, claimId, status: "APPLYING" } });
}

/** Record a dismissal. An applied or in-flight proposal cannot be dismissed; its status says why. */
export async function dismissProposal(
  conversationId: string,
  key: string,
  userId: string,
): Promise<{ dismissed: true } | { dismissed: false; status: string }> {
  try {
    await db.aiProposalDecision.create({
      data: { conversationId, proposalKey: key, status: "DISMISSED", decidedById: userId },
    });
    return { dismissed: true };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const existing = await db.aiProposalDecision.findUnique({ where: keyOf(conversationId, key), select: { status: true } });
    return existing?.status === "DISMISSED" ? { dismissed: true } : { dismissed: false, status: existing?.status ?? "UNKNOWN" };
  }
}

const DECISION_BY_STATUS: Record<string, ProposalDecision["status"]> = {
  APPLIED: "applied",
  DISMISSED: "dismissed",
  APPLYING: "unconfirmed",
};

/** Every decision in a conversation, by proposal key. */
export async function proposalDecisions(conversationId: string): Promise<Map<string, ProposalDecision>> {
  const rows = await db.aiProposalDecision.findMany({
    where: { conversationId },
    select: { proposalKey: true, status: true, summary: true },
  });
  return new Map(
    rows
      .filter((r) => r.status in DECISION_BY_STATUS)
      .map((r): [string, ProposalDecision] => [
        r.proposalKey,
        { status: DECISION_BY_STATUS[r.status], summary: r.summary ?? undefined },
      ]),
  );
}
