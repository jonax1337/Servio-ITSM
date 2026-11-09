import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Service accounts: the pure rules, board eligibility, and what an edit of the flags does (and does not do)
 * to approvals that are already in progress.
 */

const db = vi.hoisted(() => ({
  user: { findMany: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
  changeApproval: { count: vi.fn(), create: vi.fn(), createMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  change: { update: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import {
  MAY_APPROVE_CHANGES_WHERE,
  NOT_AN_APPROVER_ERROR,
  SERVICE_ACCOUNT_CANNOT_APPROVE,
  approverAccountError,
  mayApproveChanges,
  resolveAccountFlags,
  withoutBlockedRecipients,
} from "@/lib/service-accounts";
import { invalidSeats, seatBoard } from "@/lib/change-rules";
import { isEligibleApprover, selectApprovers } from "@/lib/cab";
import { applyAccountFlags } from "@/lib/user-accounts";

const person = { isServiceAccount: false, canApproveChanges: true };
const robot = { isServiceAccount: true, canApproveChanges: false };

beforeEach(() => vi.resetAllMocks());

describe("mayApproveChanges", () => {
  it("is true for a person with the switch on, false for a service account or a switched-off person", () => {
    expect(mayApproveChanges(person)).toBe(true);
    expect(mayApproveChanges(robot)).toBe(false);
    expect(mayApproveChanges({ isServiceAccount: false, canApproveChanges: false })).toBe(false);
    // A service account is out whatever the switch says.
    expect(mayApproveChanges({ isServiceAccount: true, canApproveChanges: true })).toBe(false);
  });

  it("explains the refusal", () => {
    expect(approverAccountError(person)).toBeNull();
    expect(approverAccountError(robot)).toBe(NOT_AN_APPROVER_ERROR);
  });
});

describe("resolveAccountFlags", () => {
  it("turns the switch off when an account is marked, and on again when it is unmarked", () => {
    expect(resolveAccountFlags(person, { isServiceAccount: true })).toEqual({ ok: true, isServiceAccount: true, canApproveChanges: false });
    expect(resolveAccountFlags(robot, { isServiceAccount: false })).toEqual({ ok: true, isServiceAccount: false, canApproveChanges: true });
  });

  it("leaves everything alone when nothing is sent or the type does not change", () => {
    expect(resolveAccountFlags(person, {})).toEqual({ ok: true, ...person });
    expect(resolveAccountFlags(robot, { isServiceAccount: true })).toEqual({ ok: true, ...robot });
    expect(resolveAccountFlags({ isServiceAccount: false, canApproveChanges: false }, { isServiceAccount: false })).toEqual({
      ok: true, isServiceAccount: false, canApproveChanges: false,
    });
  });

  it("lets an explicit switch value win for a person", () => {
    expect(resolveAccountFlags(person, { canApproveChanges: false })).toEqual({ ok: true, isServiceAccount: false, canApproveChanges: false });
    expect(resolveAccountFlags(robot, { isServiceAccount: false, canApproveChanges: false })).toEqual({
      ok: true, isServiceAccount: false, canApproveChanges: false,
    });
  });

  it("refuses to switch a service account on, in the same edit or afterwards", () => {
    expect(resolveAccountFlags(person, { isServiceAccount: true, canApproveChanges: true })).toEqual({ ok: false, error: SERVICE_ACCOUNT_CANNOT_APPROVE });
    expect(resolveAccountFlags(robot, { canApproveChanges: true })).toEqual({ ok: false, error: SERVICE_ACCOUNT_CANNOT_APPROVE });
    // Switching it off explicitly is fine.
    expect(resolveAccountFlags(robot, { canApproveChanges: false })).toEqual({ ok: true, ...robot });
  });
});

describe("withoutBlockedRecipients", () => {
  const blocked = new Set(["robot@example.test", "alias@example.test"]);

  it("keeps a message to ordinary recipients as it is", () => {
    expect(withoutBlockedRecipients({ to: "a@example.test", cc: ["b@example.test"] }, blocked)).toEqual({ to: "a@example.test", cc: ["b@example.test"], bcc: [] });
  });

  it("drops blocked addresses from cc and bcc, whatever their case or spacing", () => {
    expect(withoutBlockedRecipients({ to: "a@example.test", cc: ["Robot@Example.test", "b@example.test"], bcc: [" alias@example.test "] }, blocked)).toEqual({
      to: "a@example.test", cc: ["b@example.test"], bcc: [],
    });
  });

  it("hands the message to the first person copied when the main recipient is blocked", () => {
    expect(withoutBlockedRecipients({ to: "robot@example.test", cc: ["b@example.test", "c@example.test"] }, blocked)).toEqual({
      to: "b@example.test", cc: ["c@example.test"], bcc: [],
    });
  });

  it("is null when nobody is left", () => {
    expect(withoutBlockedRecipients({ to: "robot@example.test" }, blocked)).toBeNull();
    expect(withoutBlockedRecipients({ to: "robot@example.test", cc: ["alias@example.test"] }, blocked)).toBeNull();
  });
});

describe("approval board eligibility", () => {
  it("auto-selection only offers accounts that may approve", async () => {
    db.user.findMany.mockResolvedValue([{ id: "a1" }]);
    await selectApprovers({ id: 1, type: "NORMAL", risk: "MEDIUM", assigneeId: "owner", createdById: "creator" });
    const { where } = db.user.findMany.mock.calls[0][0];
    expect(where).toMatchObject({ isActive: true, ...MAY_APPROVE_CHANGES_WHERE, role: { in: ["ADMIN", "MANAGER"] } });
    expect(MAY_APPROVE_CHANGES_WHERE).toEqual({ isServiceAccount: false, canApproveChanges: true });
  });

  it("an emergency board takes its two seats from the accounts that may approve", async () => {
    // The break-glass admin is filtered out by the query, so it cannot take one of the two ECAB seats.
    db.user.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }, { id: "m1" }]);
    expect(await selectApprovers({ id: 1, type: "EMERGENCY", risk: "HIGH", assigneeId: null, createdById: null })).toEqual(["a1", "a2"]);
  });

  it("refuses to seat a service account or a switched-off account by hand", async () => {
    db.user.findUnique.mockResolvedValue({ role: "ADMIN", isActive: true, ...robot });
    expect(await isEligibleApprover("u1", "LOW")).toBe(false);
    db.user.findUnique.mockResolvedValue({ role: "ADMIN", isActive: true, isServiceAccount: false, canApproveChanges: false });
    expect(await isEligibleApprover("u1", "LOW")).toBe(false);
    db.user.findUnique.mockResolvedValue({ role: "ADMIN", isActive: true, ...person });
    expect(await isEligibleApprover("u1", "LOW")).toBe(true);
  });

  it("drops such an account from a draft board when it is submitted", () => {
    const seats = [
      { approvalId: "s1", approverId: "m1", role: "MANAGER", isActive: true, mayApprove: true },
      { approvalId: "s2", approverId: "break-glass", role: "ADMIN", isActive: true, mayApprove: false },
    ];
    expect(invalidSeats(seats, { assigneeId: null, createdById: null }, ["ADMIN", "MANAGER"]).map((s) => s.approverId)).toEqual(["break-glass"]);
  });

  it("does not seat such an account as owner or requester in the self-approval modes", () => {
    const parties = [
      { id: "robot", role: "ADMIN", isActive: true, mayApprove: false },
      { id: "person", role: "ADMIN", isActive: true, mayApprove: true },
    ];
    const seated = seatBoard({ mode: "ALWAYS", selected: [], kept: [], parties, eligibleRoles: ["ADMIN", "MANAGER"] });
    expect(seated.selfIds).toEqual(["person"]);
  });
});

describe("changing the flags with approvals in progress", () => {
  it("never writes to an approval or a change: open seats stay, nothing is approved, rejected or removed", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ ...person });
    db.changeApproval.count.mockResolvedValue(3);
    const result = await applyAccountFlags("u1", { isServiceAccount: true }, db as never);
    expect(result).toEqual({ ok: true, changed: ["isServiceAccount", "canApproveChanges"], openSeats: 3 });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { isServiceAccount: true, canApproveChanges: false } });
    // Only a count of the pending seats on changes in approval is read.
    expect(db.changeApproval.count).toHaveBeenCalledWith({ where: { approverId: "u1", status: "PENDING", change: { status: "APPROVAL" } } });
    for (const write of ["create", "createMany", "update", "updateMany", "delete", "deleteMany"] as const) {
      expect(db.changeApproval[write], `changeApproval.${write}`).not.toHaveBeenCalled();
    }
    expect(db.change.update).not.toHaveBeenCalled();
    expect(db.change.updateMany).not.toHaveBeenCalled();
  });

  it("writes nothing when the flags already have the requested values", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ ...robot });
    expect(await applyAccountFlags("u1", { isServiceAccount: true }, db as never)).toEqual({ ok: true, changed: [], openSeats: 0 });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("turning the switch back on reports no open seats and does not re-seat anyone", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ isServiceAccount: false, canApproveChanges: false });
    expect(await applyAccountFlags("u1", { canApproveChanges: true }, db as never)).toEqual({ ok: true, changed: ["canApproveChanges"], openSeats: 0 });
    expect(db.changeApproval.createMany).not.toHaveBeenCalled();
    expect(db.changeApproval.create).not.toHaveBeenCalled();
  });

  it("refuses a contradictory edit without writing", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ ...person });
    expect(await applyAccountFlags("u1", { isServiceAccount: true, canApproveChanges: true }, db as never)).toEqual({ ok: false, error: SERVICE_ACCOUNT_CANNOT_APPROVE });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("an edit that sends no account fields touches nothing", async () => {
    expect(await applyAccountFlags("u1", {}, db as never)).toEqual({ ok: true, changed: [], openSeats: 0 });
    expect(db.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
