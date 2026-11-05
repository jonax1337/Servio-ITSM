import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/** In-memory stand-in for the AiProposalDecision table with its unique (conversationId, proposalKey). */
type Row = {
  id: string;
  conversationId: string;
  proposalKey: string;
  status: string;
  claimId: string | null;
  summary: string | null;
  decidedById: string;
  updatedAt: Date;
};

const table = vi.hoisted(() => ({ rows: [] as Row[], seq: 0 }));

const matches = (row: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) =>
    v instanceof Date ? row[k as keyof Row] instanceof Date && (row[k as keyof Row] as Date).getTime() === v.getTime() : row[k as keyof Row] === v,
  );

vi.mock("@/lib/db", () => ({
  db: {
    aiProposalDecision: {
      create: async ({ data }: { data: Omit<Row, "id" | "updatedAt" | "claimId" | "summary"> & Partial<Row> }) => {
        if (table.rows.some((r) => r.conversationId === data.conversationId && r.proposalKey === data.proposalKey)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
        }
        const row: Row = { claimId: null, summary: null, ...data, id: `d${++table.seq}`, updatedAt: new Date(table.seq) };
        table.rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { conversationId_proposalKey: { conversationId: string; proposalKey: string } } }) =>
        table.rows.find((r) => matches(r, where.conversationId_proposalKey)) ?? null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const hit = table.rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data, { updatedAt: new Date(++table.seq) }));
        return { count: hit.length };
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const before = table.rows.length;
        table.rows = table.rows.filter((r) => !matches(r, where));
        return { count: before - table.rows.length };
      },
      findMany: async ({ where }: { where: { conversationId: string } }) =>
        table.rows.filter((r) => r.conversationId === where.conversationId),
    },
  },
}));
vi.mock("@/lib/ai-operations/registry", () => ({ findOperation: () => undefined }));

import {
  claimProposal,
  dismissProposal,
  markProposalApplied,
  proposalDecisions,
  proposalKey,
  releaseProposalClaim,
} from "@/lib/ai-proposal-decisions";

const CONV = "conv1";
const KEY = "call:toolu_1:abc";

beforeEach(() => {
  table.rows = [];
  table.seq = 0;
});

async function claimed() {
  const claim = await claimProposal(CONV, KEY, "u1");
  if (!claim.claimed) throw new Error("expected the claim to be won");
  return claim.claimId;
}

describe("proposalKey", () => {
  it("separates two tool calls with identical content", () => {
    const content = { operationId: "ticket.comment", args: { ref: "INC-1", text: "Hi" } };
    expect(proposalKey({ ...content, toolCallId: "toolu_a" })).not.toBe(proposalKey({ ...content, toolCallId: "toolu_b" }));
  });

  it("binds a tool call id to its args", () => {
    const base = { operationId: "ticket.comment", toolCallId: "toolu_a" };
    expect(proposalKey({ ...base, args: { text: "Hi" } })).not.toBe(proposalKey({ ...base, args: { text: "Bye" } }));
  });
});

describe("claimProposal", () => {
  it("lets exactly one of two concurrent approvals win", async () => {
    const [a, b] = await Promise.all([claimProposal(CONV, KEY, "u1"), claimProposal(CONV, KEY, "u1")]);
    expect([a.claimed, b.claimed].sort()).toEqual([false, true]);
  });

  it("answers an applied proposal with its original result instead of running it again", async () => {
    const claimId = await claimed();
    await markProposalApplied(CONV, KEY, claimId, "Added a comment to INC-1");
    expect(await claimProposal(CONV, KEY, "u1")).toEqual({
      claimed: false,
      reason: "This proposal has already been applied.",
      appliedSummary: "Added a comment to INC-1",
    });
  });

  it("never retakes an unfinished apply, however old", async () => {
    await claimed();
    table.rows[0].updatedAt = new Date(0);
    expect(await claimProposal(CONV, KEY, "u1")).toMatchObject({ claimed: false });
  });

  it("lets a dismissed proposal be approved after all", async () => {
    await dismissProposal(CONV, KEY, "u1");
    expect(await claimProposal(CONV, KEY, "u1")).toMatchObject({ claimed: true });
  });

  it("is free again after its claim was released", async () => {
    const claimId = await claimed();
    await releaseProposalClaim(CONV, KEY, claimId);
    expect(await claimProposal(CONV, KEY, "u1")).toMatchObject({ claimed: true });
  });
});

describe("claim tokens", () => {
  it("ignore a release or mark with someone else's claim id", async () => {
    await claimed();
    await releaseProposalClaim(CONV, KEY, "not-mine");
    await markProposalApplied(CONV, KEY, "not-mine", "nope");
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]).toMatchObject({ status: "APPLYING", summary: null });
  });
});

describe("dismissProposal", () => {
  it("refuses an applied or in-flight proposal and says which", async () => {
    const claimId = await claimed();
    expect(await dismissProposal(CONV, KEY, "u1")).toEqual({ dismissed: false, status: "APPLYING" });
    await markProposalApplied(CONV, KEY, claimId, "done");
    expect(await dismissProposal(CONV, KEY, "u1")).toEqual({ dismissed: false, status: "APPLIED" });
  });
});

describe("proposalDecisions", () => {
  it("reports applied, dismissed and unconfirmed proposals by key", async () => {
    const applied = await claimProposal(CONV, "k-applied", "u1");
    if (applied.claimed) await markProposalApplied(CONV, "k-applied", applied.claimId, "done");
    await dismissProposal(CONV, "k-dismissed", "u1");
    await claimProposal(CONV, "k-stuck", "u1");

    const decisions = await proposalDecisions(CONV);
    expect(decisions.get("k-applied")).toEqual({ status: "applied", summary: "done" });
    expect(decisions.get("k-dismissed")).toEqual({ status: "dismissed", summary: undefined });
    expect(decisions.get("k-stuck")).toEqual({ status: "unconfirmed", summary: undefined });
  });
});
