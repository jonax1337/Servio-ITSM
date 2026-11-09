import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ auditLog: { findFirst: vi.fn() } }));
const isGroupMember = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/assignment", () => ({ isGroupMember }));
vi.mock("@/lib/session", () => ({
  hasRole: (role: string, min: string) => ["USER", "AGENT", "MANAGER", "ADMIN"].indexOf(role) >= ["USER", "AGENT", "MANAGER", "ADMIN"].indexOf(min),
}));

import { canResolveTicket, filedOwnApiTicket } from "@/lib/authz";

const agent = { id: "svc", role: "AGENT" };
const grouped = { id: 5, groupId: "g1", assigneeId: null, requesterId: "svc", source: "API" };

beforeEach(() => {
  vi.resetAllMocks();
  isGroupMember.mockResolvedValue(false);
  db.auditLog.findFirst.mockResolvedValue(null);
});

describe("filedOwnApiTicket", () => {
  it("is the requester of an API ticket, or the audited creator", () => {
    expect(filedOwnApiTicket({ id: "a" }, { requesterId: "a", source: "API" }, false)).toBe(true);
    expect(filedOwnApiTicket({ id: "a" }, { requesterId: "a", source: "AGENT" }, false)).toBe(false);
    expect(filedOwnApiTicket({ id: "a" }, { requesterId: "b", source: "API" }, false)).toBe(false);
    expect(filedOwnApiTicket({ id: "a" }, { requesterId: "b", source: "API" }, true)).toBe(true);
  });
});

describe("canResolveTicket", () => {
  it("lets an integration resolve the alert it filed although it is not in the ticket's group", async () => {
    expect(await canResolveTicket(agent, grouped)).toBe(true);
  });

  it("lets it resolve a ticket it filed on someone's behalf (audit entry)", async () => {
    db.auditLog.findFirst.mockResolvedValue({ id: "a1" });
    expect(await canResolveTicket(agent, { ...grouped, requesterId: "someone" })).toBe(true);
    expect(db.auditLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ entityId: "5", userId: "svc", action: "CREATE" }) }),
    );
  });

  it("still refuses an agent outside the group who did not file the ticket", async () => {
    expect(await canResolveTicket({ id: "other", role: "AGENT" }, grouped)).toBe(false);
    expect(await canResolveTicket(agent, { ...grouped, requesterId: "someone", source: "PORTAL" })).toBe(false);
  });

  it("never lets a plain user resolve, even their own API ticket", async () => {
    expect(await canResolveTicket({ id: "svc", role: "USER" }, grouped)).toBe(false);
  });

  it("keeps the usual rights: manager anywhere, group member", async () => {
    expect(await canResolveTicket({ id: "m", role: "MANAGER" }, { ...grouped, requesterId: "x", source: "PORTAL" })).toBe(true);
    isGroupMember.mockResolvedValue(true);
    expect(await canResolveTicket({ id: "g", role: "AGENT" }, { ...grouped, requesterId: "x", source: "PORTAL" })).toBe(true);
  });
});
