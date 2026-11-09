import { beforeEach, describe, expect, it, vi } from "vitest";

/** PATCH /users/{id}: the account type (`service_account`, `can_approve_changes`) next to the secondary addresses. */

type Row = Record<string, unknown>;
const world = vi.hoisted(() => ({
  role: "ADMIN",
  user: { id: "u1", email: "robot@example.test", name: "Robot", role: "AGENT", isActive: true, isServiceAccount: false, canApproveChanges: true, secondaryEmails: [] as { email: string }[] } as Row,
  openSeats: 0,
  updates: [] as Row[],
  audits: [] as { summary?: string; meta?: Row }[],
  approvalWrites: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAudit: async (a: { summary?: string; meta?: Row }) => { world.audits.push(a); } }));
vi.mock("@/app/api/v1/_itsm", async (importActual) => ({
  ...(await importActual<typeof import("@/app/api/v1/_itsm")>()),
  agentGuard: async () => ({ principal: { userId: "admin", role: world.role, tokenId: "t1" } }),
}));
vi.mock("@/lib/db", () => {
  const tx: Record<string, unknown> = {
    user: {
      findUnique: async () => ({ ...world.user }),
      findUniqueOrThrow: async () => ({ ...world.user }),
      update: async ({ data }: { data: Row }) => { world.updates.push(data); Object.assign(world.user, data); return world.user; },
    },
    userEmail: { findMany: async () => [], findUnique: async () => null },
    changeApproval: {
      count: async () => world.openSeats,
      create: async () => { world.approvalWrites++; },
      createMany: async () => { world.approvalWrites++; },
      update: async () => { world.approvalWrites++; },
      updateMany: async () => { world.approvalWrites++; },
      deleteMany: async () => { world.approvalWrites++; },
    },
  };
  return { db: { ...tx, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } };
});

import { PATCH } from "@/app/api/v1/users/[id]/route";

const patch = async (body: unknown) => {
  const res = await PATCH(new Request("http://localhost/api/v1/users/u1", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), {
    params: Promise.resolve({ id: "u1" }),
  });
  return { status: res.status, json: (await res.json()) as { data?: Row; error?: { details?: Record<string, string[]> } } };
};

beforeEach(() => {
  world.role = "ADMIN";
  world.user = { id: "u1", email: "robot@example.test", name: "Robot", role: "AGENT", isActive: true, isServiceAccount: false, canApproveChanges: true, secondaryEmails: [] };
  world.openSeats = 0;
  world.updates = [];
  world.audits = [];
  world.approvalWrites = 0;
});

describe("PATCH /users/{id} account type", () => {
  it("marks a service account, turns the approval switch off and returns both flags", async () => {
    const { status, json } = await patch({ service_account: true });
    expect(status).toBe(200);
    expect(json.data).toMatchObject({ service_account: true, can_approve_changes: false });
    expect(world.updates).toEqual([{ isServiceAccount: true, canApproveChanges: false }]);
    expect(world.audits[0].summary).toBe("Edited profile via API: isServiceAccount, canApproveChanges");
  });

  it("unmarking turns the switch back on", async () => {
    world.user = { ...world.user, isServiceAccount: true, canApproveChanges: false };
    const { json } = await patch({ service_account: false });
    expect(json.data).toMatchObject({ service_account: false, can_approve_changes: true });
  });

  it("sets the switch on its own for a person", async () => {
    const { json } = await patch({ can_approve_changes: false });
    expect(json.data).toMatchObject({ service_account: false, can_approve_changes: false });
  });

  it("is a 422 to make a service account an approver", async () => {
    const { status, json } = await patch({ service_account: true, can_approve_changes: true });
    expect(status).toBe(422);
    expect(json.error?.details).toHaveProperty("can_approve_changes");
    expect(world.updates).toEqual([]);
  });

  it("leaves approvals in progress alone and reports how many open seats stay in the audit entry", async () => {
    world.openSeats = 2;
    await patch({ service_account: true });
    expect(world.approvalWrites).toBe(0);
    expect(world.audits[0].meta).toMatchObject({ openApprovalSeatsKept: 2 });
  });

  it("writes nothing and no audit row when the flags already have those values", async () => {
    const { status } = await patch({ service_account: false, can_approve_changes: true });
    expect(status).toBe(200);
    expect(world.updates).toEqual([]);
    expect(world.audits).toEqual([]);
  });

  it("still needs an ADMIN token, and rejects an empty body and unknown fields", async () => {
    world.role = "MANAGER";
    expect((await patch({ service_account: true })).status).toBe(403);
    world.role = "ADMIN";
    expect((await patch({})).status).toBe(422);
    expect((await patch({ service: true })).status).toBe(422);
    expect((await patch({ service_account: "yes" })).status).toBe(422);
  });
});
