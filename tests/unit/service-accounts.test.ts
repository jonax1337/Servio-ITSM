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
  MAY_JOIN_APPROVAL_BOARD_WHERE,
  NOT_AN_APPROVER_ERROR,
  SERVICE_ACCOUNT_APPROVAL_ADMIN_ONLY,
  approverAccountError,
  mayApproveChanges,
  mayEnableServiceAccountApproval,
  mayJoinApprovalBoard,
  resolveAccountFlags,
  serviceAccountApprovalChange,
  withoutBlockedRecipients,
} from "@/lib/service-accounts";
import { invalidSeats, seatBoard } from "@/lib/change-rules";
import { isEligibleApprover, selectApprovers } from "@/lib/cab";
import { applyAccountFlags } from "@/lib/user-accounts";

const person = { isServiceAccount: false, canApproveChanges: true };
const robot = { isServiceAccount: true, canApproveChanges: false };

beforeEach(() => vi.resetAllMocks());

const enabledRobot = { isServiceAccount: true, canApproveChanges: true };

describe("mayApproveChanges", () => {
  it("is the per-account switch: on for a person, off for a service account unless an admin turned it on", () => {
    expect(mayApproveChanges(person)).toBe(true);
    expect(mayApproveChanges(robot)).toBe(false);
    expect(mayApproveChanges({ isServiceAccount: false, canApproveChanges: false })).toBe(false);
    expect(mayApproveChanges(enabledRobot)).toBe(true);
  });

  it("explains the refusal", () => {
    expect(approverAccountError(person)).toBeNull();
    expect(approverAccountError(robot)).toBe(NOT_AN_APPROVER_ERROR);
    expect(approverAccountError(enabledRobot)).toBeNull();
  });
});

describe("mayJoinApprovalBoard", () => {
  it("never lets a service account join a board of other people's changes, whatever its switch says", () => {
    expect(mayJoinApprovalBoard(person)).toBe(true);
    expect(mayJoinApprovalBoard(robot)).toBe(false);
    expect(mayJoinApprovalBoard(enabledRobot)).toBe(false);
    expect(mayJoinApprovalBoard({ isServiceAccount: false, canApproveChanges: false })).toBe(false);
  });
});

describe("resolveAccountFlags", () => {
  it("turns the switch off when an account is marked, and on again when it is unmarked", () => {
    expect(resolveAccountFlags(person, { isServiceAccount: true }, "ADMIN")).toEqual({ ok: true, isServiceAccount: true, canApproveChanges: false });
    expect(resolveAccountFlags(robot, { isServiceAccount: false }, "ADMIN")).toEqual({ ok: true, isServiceAccount: false, canApproveChanges: true });
  });

  it("leaves everything alone when nothing is sent or the type does not change", () => {
    expect(resolveAccountFlags(person, {}, "ADMIN")).toEqual({ ok: true, ...person });
    expect(resolveAccountFlags(robot, { isServiceAccount: true }, "ADMIN")).toEqual({ ok: true, ...robot });
    expect(resolveAccountFlags({ isServiceAccount: false, canApproveChanges: false }, { isServiceAccount: false }, "ADMIN")).toEqual({
      ok: true, isServiceAccount: false, canApproveChanges: false,
    });
  });

  it("lets an explicit switch value win for a person", () => {
    expect(resolveAccountFlags(person, { canApproveChanges: false }, "ADMIN")).toEqual({ ok: true, isServiceAccount: false, canApproveChanges: false });
    expect(resolveAccountFlags(robot, { isServiceAccount: false, canApproveChanges: false }, "ADMIN")).toEqual({
      ok: true, isServiceAccount: false, canApproveChanges: false,
    });
  });

  it("keeps the switch off for a service account by default, however the account became one", () => {
    expect(resolveAccountFlags(person, { isServiceAccount: true }, "ADMIN")).toMatchObject({ canApproveChanges: false });
    expect(resolveAccountFlags(robot, {}, "ADMIN")).toMatchObject({ canApproveChanges: false });
  });

  it("lets an ADMIN switch a service account on, in the same edit or afterwards", () => {
    expect(resolveAccountFlags(robot, { canApproveChanges: true }, "ADMIN")).toEqual({ ok: true, ...enabledRobot });
    expect(resolveAccountFlags(person, { isServiceAccount: true, canApproveChanges: true }, "ADMIN")).toEqual({ ok: true, ...enabledRobot });
  });

  it("refuses everyone else, who cannot widen a service account's rights", () => {
    for (const role of ["MANAGER", "AGENT", "USER", null, undefined]) {
      expect(resolveAccountFlags(robot, { canApproveChanges: true }, role)).toEqual({ ok: false, error: SERVICE_ACCOUNT_APPROVAL_ADMIN_ONLY });
      expect(resolveAccountFlags(person, { isServiceAccount: true, canApproveChanges: true }, role)).toEqual({ ok: false, error: SERVICE_ACCOUNT_APPROVAL_ADMIN_ONLY });
    }
    expect(mayEnableServiceAccountApproval("ADMIN")).toBe(true);
    expect(mayEnableServiceAccountApproval("MANAGER")).toBe(false);
  });

  it("does not make an edit by a non-admin fail when the account already has it", () => {
    expect(resolveAccountFlags(enabledRobot, { canApproveChanges: true }, "MANAGER")).toEqual({ ok: true, ...enabledRobot });
    expect(resolveAccountFlags(enabledRobot, {}, "MANAGER")).toEqual({ ok: true, ...enabledRobot });
  });

  it("lets anybody switch a service account off", () => {
    expect(resolveAccountFlags(enabledRobot, { canApproveChanges: false }, "MANAGER")).toEqual({ ok: true, ...robot });
  });

  it("unmarking an enabled service account gives a person that may approve", () => {
    expect(resolveAccountFlags(enabledRobot, { isServiceAccount: false }, "ADMIN")).toEqual({ ok: true, ...person });
  });
});

describe("serviceAccountApprovalChange", () => {
  it("names a service account gaining or losing the right, and nothing else", () => {
    expect(serviceAccountApprovalChange(robot, enabledRobot)).toBe("enabled");
    expect(serviceAccountApprovalChange(person, enabledRobot)).toBe("enabled");
    expect(serviceAccountApprovalChange(enabledRobot, robot)).toBe("disabled");
    expect(serviceAccountApprovalChange(enabledRobot, person)).toBe("disabled");
    expect(serviceAccountApprovalChange(person, robot)).toBeNull();
    expect(serviceAccountApprovalChange(person, { isServiceAccount: false, canApproveChanges: false })).toBeNull();
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
    expect(where).toMatchObject({ isActive: true, ...MAY_JOIN_APPROVAL_BOARD_WHERE, role: { in: ["ADMIN", "MANAGER"] } });
    expect(MAY_JOIN_APPROVAL_BOARD_WHERE).toEqual({ isServiceAccount: false, canApproveChanges: true });
  });

  it("an emergency board takes its two seats from the accounts that may approve", async () => {
    // The break-glass admin is filtered out by the query, so it cannot take one of the two ECAB seats.
    db.user.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }, { id: "m1" }]);
    expect(await selectApprovers({ id: 1, type: "EMERGENCY", risk: "HIGH", assigneeId: null, createdById: null })).toEqual(["a1", "a2"]);
  });

  it("refuses to seat a service account or a switched-off account by hand", async () => {
    db.user.findUnique.mockResolvedValue({ role: "ADMIN", isActive: true, ...robot });
    expect(await isEligibleApprover("u1", "LOW")).toBe(false);
    // ... not even one an admin allowed to approve: it joins only its own changes, through the self-approval mode.
    db.user.findUnique.mockResolvedValue({ role: "ADMIN", isActive: true, ...enabledRobot });
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
    const result = await applyAccountFlags("u1", { isServiceAccount: true }, "ADMIN", db as never);
    expect(result).toEqual({ ok: true, changed: ["isServiceAccount", "canApproveChanges"], openSeats: 3, serviceAccountApproval: null });
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
    expect(await applyAccountFlags("u1", { isServiceAccount: true }, "ADMIN", db as never)).toEqual({ ok: true, changed: [], openSeats: 0, serviceAccountApproval: null });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("turning the switch back on reports no open seats and does not re-seat anyone", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ isServiceAccount: false, canApproveChanges: false });
    expect(await applyAccountFlags("u1", { canApproveChanges: true }, "ADMIN", db as never)).toEqual({
      ok: true, changed: ["canApproveChanges"], openSeats: 0, serviceAccountApproval: null,
    });
    expect(db.changeApproval.createMany).not.toHaveBeenCalled();
    expect(db.changeApproval.create).not.toHaveBeenCalled();
  });

  it("an ADMIN can allow a service account to approve; it is reported as such and the default stays off", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ ...robot });
    db.changeApproval.count.mockResolvedValue(0);
    const result = await applyAccountFlags("u1", { canApproveChanges: true }, "ADMIN", db as never);
    expect(result).toMatchObject({ ok: true, changed: ["canApproveChanges"], serviceAccountApproval: "enabled" });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { isServiceAccount: true, canApproveChanges: true } });
  });

  it("a manager cannot: refused without writing", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ ...robot });
    expect(await applyAccountFlags("u1", { canApproveChanges: true }, "MANAGER", db as never)).toEqual({ ok: false, error: SERVICE_ACCOUNT_APPROVAL_ADMIN_ONLY });
    db.user.findUniqueOrThrow.mockResolvedValue({ ...person });
    expect(await applyAccountFlags("u1", { isServiceAccount: true, canApproveChanges: true }, "MANAGER", db as never)).toEqual({ ok: false, error: SERVICE_ACCOUNT_APPROVAL_ADMIN_ONLY });
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("switching it off again is reported, and its seats count as open", async () => {
    db.user.findUniqueOrThrow.mockResolvedValue({ ...enabledRobot });
    db.changeApproval.count.mockResolvedValue(1);
    expect(await applyAccountFlags("u1", { canApproveChanges: false }, "ADMIN", db as never)).toMatchObject({ serviceAccountApproval: "disabled", openSeats: 1 });
  });

  it("an edit that sends no account fields touches nothing", async () => {
    expect(await applyAccountFlags("u1", {}, "ADMIN", db as never)).toEqual({ ok: true, changed: [], openSeats: 0, serviceAccountApproval: null });
    expect(db.user.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
