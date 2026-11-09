import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  group: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  groupMember: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
}));
const writeAudit = vi.hoisted(() => vi.fn());
const principal = vi.hoisted(() => ({ role: "MANAGER", userId: "mgr" }));

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => undefined, signOut: async () => undefined, handlers: {} }));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/audit", () => ({ writeAudit }));
vi.mock("@/app/api/v1/_itsm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/api/v1/_itsm")>()),
  agentGuard: async () => ({ principal }),
}));

import { POST } from "@/app/api/v1/groups/[id]/members/route";
import { DELETE } from "@/app/api/v1/groups/[id]/members/[userId]/route";

const user = { id: "u1", name: "Monitor", email: "monitor@example.com", isActive: true };
const post = (body: unknown) =>
  POST(new Request("http://x/api/v1/groups/g1/members", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "g1" }) });
const del = (userId = "u1") =>
  DELETE(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: "g1", userId }) });

beforeEach(() => {
  vi.resetAllMocks();
  principal.role = "MANAGER";
  db.group.findUnique.mockResolvedValue({ id: "g1", name: "Service Desk" });
  db.user.findUnique.mockResolvedValue(user);
});

describe("POST /groups/{id}/members", () => {
  it("adds a new member (201), defaulting to MEMBER, and audits it", async () => {
    db.groupMember.findUnique.mockResolvedValue(null);
    const res = await post({ user_id: "u1" });
    expect(res.status).toBe(201);
    expect(db.groupMember.create).toHaveBeenCalledWith({ data: { groupId: "g1", userId: "u1", role: "MEMBER" } });
    expect((await res.json()).meta.created).toBe(true);
    expect(writeAudit).toHaveBeenCalledOnce();
  });

  it("is idempotent: an existing membership answers 200, keeps its role and writes nothing", async () => {
    db.groupMember.findUnique.mockResolvedValue({ role: "LEAD" });
    const res = await post({ user_id: "u1", role: "MEMBER" });
    expect(res.status).toBe(200);
    expect((await res.json()).data.role).toBe("LEAD");
    expect(db.groupMember.create).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("is idempotent under a race on the unique pair", async () => {
    db.groupMember.findUnique.mockResolvedValue(null);
    db.groupMember.create.mockRejectedValue({ code: "P2002" });
    db.groupMember.findUniqueOrThrow.mockResolvedValue({ role: "MEMBER" });
    const res = await post({ user_id: "u1" });
    expect(res.status).toBe(200);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("needs a manager or admin token owner", async () => {
    principal.role = "AGENT";
    expect((await post({ user_id: "u1" })).status).toBe(403);
    expect(db.groupMember.create).not.toHaveBeenCalled();
  });

  it("404 for an unknown group, 422 for an unknown user or unknown fields", async () => {
    db.group.findUnique.mockResolvedValue(null);
    expect((await post({ user_id: "u1" })).status).toBe(404);
    db.group.findUnique.mockResolvedValue({ id: "g1", name: "Service Desk" });
    db.user.findUnique.mockResolvedValue(null);
    expect((await post({ user_id: "nope" })).status).toBe(422);
    expect((await post({ user_id: "u1", extra: 1 })).status).toBe(422);
    expect((await post({ user_id: "u1", role: "BOSS" })).status).toBe(422);
  });
});

describe("DELETE /groups/{id}/members/{userId}", () => {
  it("removes a member and audits it", async () => {
    db.groupMember.findUnique.mockResolvedValue({ id: "m1", user: { name: "Monitor", email: "monitor@example.com" } });
    db.groupMember.deleteMany.mockResolvedValue({ count: 1 });
    const res = await del();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ group_id: "g1", user_id: "u1", removed: true });
    expect(writeAudit).toHaveBeenCalledOnce();
  });

  it("is idempotent for a user who is not a member", async () => {
    db.groupMember.findUnique.mockResolvedValue(null);
    const res = await del();
    expect(res.status).toBe(200);
    expect((await res.json()).data.removed).toBe(false);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("needs a manager or admin token owner", async () => {
    principal.role = "AGENT";
    expect((await del()).status).toBe(403);
  });
});
