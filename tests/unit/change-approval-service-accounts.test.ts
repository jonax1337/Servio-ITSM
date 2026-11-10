import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The change actions around approval boards: who may decide, who may be seated by hand, and what happens to a
 * draft board when it is submitted - with service accounts and the "may approve changes" switch in the mix.
 */

type Row = Record<string, unknown>;
const world = vi.hoisted(() => ({
  me: null as Row | null,
  approval: null as Row | null,
  change: null as Row | null,
  seats: [] as Row[],
  candidates: [] as Row[],
  users: new Map<string, Row>(),
  writes: [] as string[],
  audits: [] as string[],
  mode: "OFF" as string,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => undefined, signOut: async () => undefined, handlers: {} }));
vi.mock("@/lib/audit", () => ({
  writeAudit: async (a: { summary?: string }) => { world.audits.push(a.summary ?? ""); },
  notify: async () => {},
}));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  requireAgentUser: async () => world.me,
  getCurrentUser: async () => world.me,
}));
vi.mock("@/lib/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/settings")>()),
  getSetting: async () => null,
  getChangeSelfApprovalMode: async () => world.mode,
}));
vi.mock("@/lib/change-schedule", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/change-schedule")>()),
  freezeHitsForWindow: async () => [],
  assetIdsOfChange: async () => [],
}));
vi.mock("@/lib/db", () => {
  const tx: Record<string, unknown> = {
    changeApproval: {
      findUnique: async () => world.approval,
      findFirst: async () => null,
      findMany: async ({ where }: { where?: { changeId?: number } }) => (where?.changeId !== undefined ? world.seats : []),
      create: async () => { world.writes.push("approval.create"); },
      createMany: async ({ data }: { data: Row[] }) => { world.writes.push(`approval.createMany:${data.map((d) => d.approverId).join(",")}`); },
      deleteMany: async ({ where }: { where: { id: { in: string[] } | string } }) => { world.writes.push(`approval.deleteMany:${JSON.stringify(where.id)}`); return { count: 1 }; },
      update: async () => { world.writes.push("approval.update"); },
      updateMany: async () => ({ count: 0 }),
    },
    change: {
      findUnique: async () => world.change,
      updateMany: async () => { world.writes.push("change.updateMany"); return { count: 1 }; },
    },
    changeComment: { create: async () => {} },
    user: {
      findMany: async (args: { where: { id?: unknown } }) => {
        const ids = args.where.id && typeof args.where.id === "object" && "in" in (args.where.id as object) ? (args.where.id as { in: string[] }).in : null;
        // The owner and requester of a change are looked up by id; the auto-selected board comes from `candidates`.
        return ids ? ids.filter((id) => world.users.has(id)).map((id) => ({ id, ...world.users.get(id) })) : world.candidates;
      },
      findUnique: async ({ where }: { where: { id: string } }) => world.users.get(where.id) ?? null,
    },
    changeAsset: { findMany: async () => [] },
  };
  const db = { ...tx, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
  return { db: new Proxy(db, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : new Proxy({}, { get: () => async () => null })) }) };
});

import { addChangeApprover, decideApproval, submitChangeForApproval } from "@/lib/actions/changes";

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  world.mode = "OFF";
  world.writes = [];
  world.audits = [];
  world.seats = [];
  world.candidates = [];
  world.users = new Map();
  world.me = { id: "adm", role: "ADMIN", isActive: true, isServiceAccount: false, canApproveChanges: true };
  world.approval = { id: "ap1", changeId: 7, approverId: "adm", status: "PENDING" };
  world.change = { status: "APPROVAL", assigneeId: "owner", createdById: "creator", risk: "MEDIUM" };
});

describe("decideApproval", () => {
  it("lets an account that may approve decide its seat", async () => {
    const result = await decideApproval(form({ approvalId: "ap1", decision: "APPROVED" }));
    expect(result).toMatchObject({ ok: true });
    expect(world.writes).toContain("approval.update");
  });

  it.each([
    ["a service account", { isServiceAccount: true, canApproveChanges: false }],
    ["an account whose switch is off", { isServiceAccount: false, canApproveChanges: false }],
  ])("refuses %s, even as an admin, and decides nothing", async (_name, flags) => {
    world.me = { ...world.me!, ...flags };
    const result = await decideApproval(form({ approvalId: "ap1", decision: "APPROVED" }));
    expect(result).toMatchObject({ ok: false, error: "This account may not approve changes." });
    expect(world.writes).toEqual([]);
  });

  it("refuses a switched-off admin who tries to decide somebody else's seat", async () => {
    world.me = { ...world.me!, canApproveChanges: false };
    world.approval = { id: "ap1", changeId: 7, approverId: "someone-else", status: "PENDING" };
    expect(await decideApproval(form({ approvalId: "ap1", decision: "APPROVED" }))).toMatchObject({ ok: false });
    expect(world.writes).toEqual([]);
  });
});

describe("addChangeApprover", () => {
  beforeEach(() => {
    world.me = { id: "mgr", role: "MANAGER", isActive: true, isServiceAccount: false, canApproveChanges: true };
    world.change = { status: "DRAFT", assigneeId: "owner", createdById: "creator", risk: "LOW", type: "NORMAL", templateId: null, title: "Patch" };
  });

  it("will not seat a service account or a switched-off admin by hand", async () => {
    world.users.set("robot", { role: "ADMIN", isActive: true, isServiceAccount: true, canApproveChanges: false });
    world.users.set("off", { role: "ADMIN", isActive: true, isServiceAccount: false, canApproveChanges: false });
    for (const approverId of ["robot", "off"]) {
      expect(await addChangeApprover(form({ changeId: "7", approverId }))).toMatchObject({ ok: false });
    }
    expect(world.writes).toEqual([]);
  });

  it("seats an account that may approve", async () => {
    world.users.set("adm2", { role: "ADMIN", isActive: true, isServiceAccount: false, canApproveChanges: true });
    expect(await addChangeApprover(form({ changeId: "7", approverId: "adm2" }))).toMatchObject({ ok: true });
  });
});

describe("submitChangeForApproval and the board", () => {
  beforeEach(() => {
    world.me = { id: "owner", role: "AGENT", isActive: true, isServiceAccount: false, canApproveChanges: true };
    world.change = {
      id: 7, type: "NORMAL", risk: "MEDIUM", status: "DRAFT", assigneeId: "owner", createdById: "owner", title: "Patch", groupId: null,
      implementationPlan: "Do it", rollbackPlan: "Undo it", plannedStart: new Date("2026-12-01T10:00:00Z"), plannedEnd: new Date("2026-12-01T11:00:00Z"),
      templateId: null, template: null,
    };
  });

  it("drops the pending seat of an account that may no longer approve from a draft board, and says so", async () => {
    world.seats = [
      { id: "s1", approverId: "m1", approver: { role: "MANAGER", isActive: true, isServiceAccount: false, canApproveChanges: true } },
      { id: "s2", approverId: "break-glass", approver: { role: "ADMIN", isActive: true, isServiceAccount: true, canApproveChanges: false } },
    ];
    const result = await submitChangeForApproval(form({ id: "7" }));
    expect(result).toMatchObject({ ok: true });
    expect(world.writes).toContain('approval.deleteMany:{"in":["s2"]}');
    expect(world.audits.some((a) => a.includes("1 ineligible approver removed"))).toBe(true);
  });

  it("never re-seats a board that is already in approval: nothing is dropped, added or decided", async () => {
    world.change = { ...world.change!, status: "APPROVAL" };
    world.seats = [{ id: "s2", approverId: "break-glass", approver: { role: "ADMIN", isActive: true, isServiceAccount: true, canApproveChanges: false } }];
    expect(await submitChangeForApproval(form({ id: "7" }))).toMatchObject({ ok: false });
    expect(world.writes).toEqual([]);
  });

  it("never approves a change whose whole board became ineligible: it stays a draft", async () => {
    world.seats = [{ id: "s2", approverId: "break-glass", approver: { role: "ADMIN", isActive: true, isServiceAccount: true, canApproveChanges: false } }];
    world.candidates = []; // the auto-selection finds nobody who may approve either
    const result = await submitChangeForApproval(form({ id: "7" }));
    expect(result).toMatchObject({ ok: false, error: "No eligible CAB approvers are available for this change." });
    expect(world.writes).toEqual([]);
  });
});

// A service account an admin allowed to approve: it self-approves its own changes where the mode allows.

const bot = { id: "bot", role: "MANAGER", isActive: true, isServiceAccount: true, canApproveChanges: true };

describe("a service account that is allowed to approve changes", () => {
  describe("deciding", () => {
    beforeEach(() => {
      world.me = { ...bot };
      world.mode = "ALWAYS";
      world.approval = { id: "ap1", changeId: 7, approverId: "bot", status: "PENDING" };
      world.change = { status: "APPROVAL", assigneeId: "bot", createdById: "bot", risk: "LOW" };
    });

    it("self-approves its own change, with a justification, where the mode allows", async () => {
      const result = await decideApproval(form({ approvalId: "ap1", decision: "APPROVED", comment: "Routine patch, rolled back automatically on failure" }));
      expect(result).toMatchObject({ ok: true });
      expect(world.writes).toContain("approval.update");
    });

    it("needs the written justification every self-approval needs", async () => {
      expect(await decideApproval(form({ approvalId: "ap1", decision: "APPROVED" }))).toMatchObject({ ok: false });
      expect(world.writes).toEqual([]);
    });

    it("is refused while the self-approval mode is off", async () => {
      world.mode = "OFF";
      expect(await decideApproval(form({ approvalId: "ap1", decision: "APPROVED", comment: "ok" }))).toMatchObject({ ok: false });
      expect(world.writes).toEqual([]);
    });

    it("is refused on a risk its role may not approve (only an admin approves HIGH)", async () => {
      world.change = { ...world.change!, risk: "HIGH" };
      expect(await decideApproval(form({ approvalId: "ap1", decision: "APPROVED", comment: "ok" }))).toMatchObject({ ok: false });
      expect(world.writes).toEqual([]);
    });

    it("decides only its own seat, even as an admin: never another approver seat", async () => {
      world.me = { ...bot, role: "ADMIN" };
      world.approval = { id: "ap1", changeId: 7, approverId: "someone-else", status: "PENDING" };
      world.change = { status: "APPROVAL", assigneeId: "owner", createdById: "creator", risk: "LOW" };
      expect(await decideApproval(form({ approvalId: "ap1", decision: "APPROVED" }))).toMatchObject({ ok: false, error: "A service account can only decide its own approval seat." });
      expect(world.writes).toEqual([]);
    });

    it("stays refused when the switch is off, which is the default for a service account", async () => {
      world.me = { ...bot, canApproveChanges: false };
      expect(await decideApproval(form({ approvalId: "ap1", decision: "APPROVED", comment: "ok" }))).toMatchObject({ ok: false, error: "This account may not approve changes." });
      expect(world.writes).toEqual([]);
    });
  });

  describe("board seating", () => {
    beforeEach(() => {
      world.me = { ...bot };
      world.users.set("bot", { role: "MANAGER", isActive: true, isServiceAccount: true, canApproveChanges: true });
      world.change = {
        id: 7, type: "NORMAL", risk: "LOW", status: "DRAFT", assigneeId: "bot", createdById: "bot", title: "Patch", groupId: null,
        implementationPlan: "Do it", rollbackPlan: "Undo it", plannedStart: new Date("2026-12-01T10:00:00Z"), plannedEnd: new Date("2026-12-01T11:00:00Z"),
        templateId: null, template: null,
      };
    });

    it("is not seated on its own change while self-approval is off", async () => {
      world.mode = "OFF";
      expect(await submitChangeForApproval(form({ id: "7" }))).toMatchObject({ ok: false, error: "No eligible CAB approvers are available for this change." });
      expect(world.writes).toEqual([]);
    });

    it("is seated on its own change when the mode is ALWAYS", async () => {
      world.mode = "ALWAYS";
      world.candidates = [{ id: "m1" }];
      expect(await submitChangeForApproval(form({ id: "7" }))).toMatchObject({ ok: true });
      expect(world.writes).toContain("approval.createMany:bot,m1");
    });

    it("is seated only when nobody else could approve in WHEN_NO_OTHER_APPROVER", async () => {
      world.mode = "WHEN_NO_OTHER_APPROVER";
      expect(await submitChangeForApproval(form({ id: "7" }))).toMatchObject({ ok: true });
      expect(world.writes).toContain("approval.createMany:bot");
      world.writes = [];
      world.candidates = [{ id: "m1" }];
      expect(await submitChangeForApproval(form({ id: "7" }))).toMatchObject({ ok: true });
      expect(world.writes).toContain("approval.createMany:m1");
    });

    it("is not seated when its switch is off, whatever the mode", async () => {
      world.mode = "ALWAYS";
      world.users.set("bot", { role: "MANAGER", isActive: true, isServiceAccount: true, canApproveChanges: false });
      expect(await submitChangeForApproval(form({ id: "7" }))).toMatchObject({ ok: false });
      expect(world.writes).toEqual([]);
    });

    it("is never seated on another person's change: the board does not take it, even by hand", async () => {
      world.mode = "ALWAYS";
      world.change = { ...world.change!, assigneeId: "owner", createdById: "owner" };
      world.users.set("owner", { role: "AGENT", isActive: true, isServiceAccount: false, canApproveChanges: true });
      world.candidates = [{ id: "m1" }]; // the auto-selection excludes service accounts in its query
      await submitChangeForApproval(form({ id: "7" }));
      expect(world.writes.join(" ")).not.toContain("bot");
      world.me = { id: "mgr", role: "MANAGER", isActive: true, isServiceAccount: false, canApproveChanges: true };
      world.change = { status: "DRAFT", assigneeId: "owner", createdById: "creator", risk: "LOW", type: "NORMAL", templateId: null, title: "Patch" };
      expect(await addChangeApprover(form({ changeId: "7", approverId: "bot" }))).toMatchObject({ ok: false });
    });
  });
});
