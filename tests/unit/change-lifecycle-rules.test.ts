import { describe, expect, it } from "vitest";
import {
  allowedOutcomes,
  approversToSeat,
  boardSizeLimit,
  canSeatApprovers,
  cancelReasonError,
  changeLockedMessage,
  closureError,
  fieldValueError,
  formatPlannedWindow,
  invalidSeats,
  isChangeLocked,
  isWindowEditable,
  manualStatusError,
  requiresRescheduleReason,
  rescheduleComment,
  rescheduleError,
  settlesApprovalBoard,
  shouldStampActualEnd,
  statusLabel,
  windowChanged,
  windowLockedMessage,
} from "@/lib/change-rules";
import { CHANGE_STATUSES } from "@/lib/constants";

const at = (hour: number) => new Date(2026, 0, 1, hour, 0);
const window10to11 = { start: at(10), end: at(11) };
const window12to13 = { start: at(12), end: at(13) };

describe("planned window editing by status", () => {
  it("is open before the CAB decides and as a reschedule after approval", () => {
    for (const status of ["DRAFT", "REJECTED", "APPROVED", "SCHEDULED"]) {
      expect(isWindowEditable(status), status).toBe(true);
    }
  });

  it("is locked while in approval, during and after implementation, and once finished", () => {
    for (const status of ["APPROVAL", "IN_PROGRESS", "REVIEW", "FAILED", "CLOSED", "CANCELLED"]) {
      expect(isWindowEditable(status), status).toBe(false);
    }
  });

  it("asks for a reason only once the change is approved", () => {
    expect(["APPROVED", "SCHEDULED"].every(requiresRescheduleReason)).toBe(true);
    expect(["DRAFT", "REJECTED"].some(requiresRescheduleReason)).toBe(false);
  });

  it("names the status that blocks the edit", () => {
    expect(windowLockedMessage("IN_PROGRESS")).toBe("The planned window can't be changed while the change is in progress.");
  });
});

describe("windowChanged", () => {
  it("is false for the same instants, even as different Date objects", () => {
    expect(windowChanged(window10to11, { start: at(10), end: at(11) })).toBe(false);
  });

  it("detects a moved start, a moved end and a cleared window", () => {
    expect(windowChanged(window10to11, { start: at(9), end: at(11) })).toBe(true);
    expect(windowChanged(window10to11, { start: at(10), end: at(12) })).toBe(true);
    expect(windowChanged(window10to11, { start: null, end: null })).toBe(true);
  });

  it("treats two empty windows as unchanged", () => {
    expect(windowChanged({ start: null, end: null }, { start: null, end: null })).toBe(false);
  });
});

describe("rescheduleError", () => {
  it("requires a reason when an approved change moves its window", () => {
    expect(rescheduleError("APPROVED", window10to11, window12to13, null)).toMatch(/reason/);
    expect(rescheduleError("SCHEDULED", window10to11, window12to13, "   ")).toMatch(/reason/);
    expect(rescheduleError("SCHEDULED", window10to11, window12to13, "Vendor delay")).toBeNull();
  });

  it("does not ask for a reason when nothing moved", () => {
    expect(rescheduleError("APPROVED", window10to11, { start: at(10), end: at(11) }, null)).toBeNull();
  });

  it("does not ask for a reason before approval", () => {
    expect(rescheduleError("DRAFT", window10to11, window12to13, null)).toBeNull();
  });

  it("refuses to clear the window of an approved change", () => {
    expect(rescheduleError("APPROVED", window10to11, { start: null, end: null }, "Oops")).toMatch(/must keep its planned window/);
  });
});

describe("rescheduleComment / formatPlannedWindow", () => {
  it("states the old and new window and the reason", () => {
    const comment = rescheduleComment(window10to11, window12to13, "  Vendor delay ");
    expect(comment).toBe(
      `Window rescheduled from ${formatPlannedWindow(window10to11)} to ${formatPlannedWindow(window12to13)}: Vendor delay`,
    );
    expect(comment).toContain(" – ");
  });

  it("describes a window that was not set", () => {
    expect(formatPlannedWindow({ start: null, end: null })).toBe("not set");
    expect(formatPlannedWindow({ start: at(10), end: null })).toMatch(/^from /);
    expect(formatPlannedWindow({ start: null, end: at(11) })).toMatch(/^until /);
  });
});

describe("isChangeLocked", () => {
  it("locks exactly the finished statuses", () => {
    expect(CHANGE_STATUSES.filter(isChangeLocked)).toEqual(["CLOSED", "CANCELLED"]);
  });

  it("explains that comments and links stay open", () => {
    expect(changeLockedMessage("CLOSED")).toBe("This change is closed and can no longer be edited. Comments and links can still be added.");
    expect(changeLockedMessage("CANCELLED")).toContain("cancelled");
  });
});

describe("closureError", () => {
  const closing = { toStatus: "CLOSED", type: "NORMAL", outcome: "SUCCESSFUL", notes: "Went fine." };

  it("passes a complete closure", () => {
    expect(closureError(closing)).toBeNull();
  });

  it("requires an outcome", () => {
    expect(closureError({ ...closing, outcome: null })).toMatch(/outcome/);
  });

  it("requires closure notes, trimmed", () => {
    expect(closureError({ ...closing, notes: null })).toMatch(/closure notes/);
    expect(closureError({ ...closing, notes: "  " })).toMatch(/closure notes/);
  });

  it("makes the post-implementation review explicit for emergency changes", () => {
    expect(closureError({ ...closing, type: "EMERGENCY", notes: null })).toMatch(/Emergency changes need a post-implementation review/);
    expect(closureError({ ...closing, type: "EMERGENCY" })).toBeNull();
  });

  it("accepts every outcome when closing", () => {
    for (const outcome of allowedOutcomes("CLOSED")) expect(closureError({ ...closing, outcome }), outcome).toBeNull();
  });

  it("limits a failed change to the failure outcomes", () => {
    const failing = { ...closing, toStatus: "FAILED" };
    expect(allowedOutcomes("FAILED")).toEqual(["FAILED", "ROLLED_BACK"]);
    expect(closureError({ ...failing, outcome: "FAILED" })).toBeNull();
    expect(closureError({ ...failing, outcome: "ROLLED_BACK" })).toBeNull();
    expect(closureError({ ...failing, outcome: "SUCCESSFUL" })).toMatch(/Failed or Rolled back/);
  });

  it("rejects an unknown outcome", () => {
    expect(closureError({ ...closing, outcome: "MAYBE" })).toMatch(/valid outcome/);
  });

  it("does not apply to other statuses", () => {
    expect(closureError({ toStatus: "REVIEW", type: "EMERGENCY", outcome: null, notes: null })).toBeNull();
  });
});

describe("cancelReasonError", () => {
  it("requires a non-blank reason", () => {
    expect(cancelReasonError(null)).toMatch(/reason/);
    expect(cancelReasonError("   ")).toMatch(/reason/);
    expect(cancelReasonError("Superseded by CHG-0042")).toBeNull();
  });
});

describe("shouldStampActualEnd", () => {
  it("stamps when work stops, not only at closure", () => {
    for (const status of ["REVIEW", "FAILED", "CLOSED"]) expect(shouldStampActualEnd(status, null), status).toBe(true);
  });

  it("keeps an end that was already recorded", () => {
    expect(shouldStampActualEnd("CLOSED", at(11))).toBe(false);
  });

  it("does not stamp for other moves", () => {
    for (const status of ["IN_PROGRESS", "CANCELLED", "DRAFT"]) expect(shouldStampActualEnd(status, null), status).toBe(false);
  });
});

describe("manualStatusError", () => {
  it("keeps the approval-flow statuses out of manual edits", () => {
    for (const status of ["APPROVAL", "APPROVED"]) expect(manualStatusError(status), status).toMatch(/approval workflow/);
  });

  it("lets every other status through", () => {
    for (const status of CHANGE_STATUSES.filter((s) => !["APPROVAL", "APPROVED"].includes(s))) {
      expect(manualStatusError(status), status).toBeNull();
    }
  });
});

describe("fieldValueError", () => {
  it("accepts values of each enum field, including the impact level", () => {
    expect(fieldValueError("impact", "HIGH")).toBeNull();
    expect(fieldValueError("risk", "LOW")).toBeNull();
    expect(fieldValueError("type", "EMERGENCY")).toBeNull();
    expect(fieldValueError("priority", "MEDIUM")).toBeNull();
    expect(fieldValueError("status", "CANCELLED")).toBeNull();
  });

  it("rejects values outside the enum and names the allowed ones", () => {
    expect(fieldValueError("impact", "HUGE")).toBe('"HUGE" is not a valid impact. Allowed: LOW, MEDIUM, HIGH.');
    expect(fieldValueError("status", "DONE")).toMatch(/not a valid status/);
  });

  it("leaves non-enum fields alone", () => {
    expect(fieldValueError("assigneeId", "anything")).toBeNull();
  });
});

describe("CAB board seating", () => {
  it("allows curating the board while drafting and while in approval", () => {
    expect(CHANGE_STATUSES.filter(canSeatApprovers)).toEqual(["DRAFT", "APPROVAL"]);
  });

  it("seats only the auto-selected approvers that are not on the board yet", () => {
    expect(approversToSeat(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
    expect(approversToSeat(["a"], ["a"])).toEqual([]);
    expect(approversToSeat(["a", "b"], [])).toEqual(["a", "b"]);
  });

  it("tops up an expedited emergency board only to its size limit, manual seats included", () => {
    const limit = boardSizeLimit("EMERGENCY");
    expect(limit).toBe(2);
    expect(approversToSeat(["a", "b"], [], limit)).toEqual(["a", "b"]);
    expect(approversToSeat(["a", "b"], ["manual"], limit)).toEqual(["a"]);
    expect(approversToSeat(["a", "b"], ["manual", "other"], limit)).toEqual([]);
    expect(approversToSeat(["a", "b"], ["m1", "m2", "m3"], limit)).toEqual([]);
  });

  it("does not cap the board of other change types", () => {
    expect(boardSizeLimit("NORMAL")).toBe(Number.POSITIVE_INFINITY);
    expect(approversToSeat(["a", "b", "c"], ["m"], boardSizeLimit("NORMAL"))).toEqual(["a", "b", "c"]);
  });
});

describe("seats that no longer qualify at submit", () => {
  const seat = (approverId: string, role = "MANAGER", isActive = true) => ({ approvalId: `ap-${approverId}`, approverId, role, isActive });
  const change = { assigneeId: "owner", createdById: "creator" };
  const roles = ["ADMIN", "MANAGER"];

  it("keeps eligible seats", () => {
    expect(invalidSeats([seat("m1"), seat("a1", "ADMIN")], change, roles)).toEqual([]);
  });

  it("drops a seat that became the owner or the creator", () => {
    const dropped = invalidSeats([seat("owner"), seat("creator", "ADMIN"), seat("m1")], change, roles);
    expect(dropped.map((s) => s.approverId)).toEqual(["owner", "creator"]);
  });

  it("drops a deactivated approver", () => {
    expect(invalidSeats([seat("m1", "MANAGER", false)], change, roles).map((s) => s.approverId)).toEqual(["m1"]);
  });

  it("drops a manager once the change risk requires an admin", () => {
    const dropped = invalidSeats([seat("m1"), seat("a1", "ADMIN")], change, ["ADMIN"]);
    expect(dropped.map((s) => s.approverId)).toEqual(["m1"]);
  });

  it("handles a change without owner or creator", () => {
    expect(invalidSeats([seat("m1")], { assigneeId: null, createdById: null }, roles)).toEqual([]);
  });
});

describe("settled approval board", () => {
  it("withdraws unanswered seats when the change is approved, rejected or cancelled", () => {
    expect([...CHANGE_STATUSES.filter(settlesApprovalBoard)].sort()).toEqual(["APPROVED", "CANCELLED", "REJECTED"]);
  });

  it("keeps the board live while drafting and in approval", () => {
    expect(settlesApprovalBoard("DRAFT")).toBe(false);
    expect(settlesApprovalBoard("APPROVAL")).toBe(false);
  });
});

describe("statusLabel", () => {
  it("uses the lifecycle label and falls back to the raw status", () => {
    expect(statusLabel("APPROVAL")).not.toBe("");
    expect(statusLabel("NOT_A_STATUS")).toBe("NOT_A_STATUS");
  });
});
