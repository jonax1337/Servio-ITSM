import { describe, expect, it } from "vitest";
import { statusChangeData } from "@/lib/sla";
import { APPROVAL_META, APPROVAL_STATUSES } from "@/lib/constants";

const now = new Date("2026-11-05T10:00:00Z");
const clock = { responseDueAt: null, resolveDueAt: null, dueAt: null, pendingSince: null, pausedMs: 0 };

// Cancelling a request that is still awaiting approval must close the approval
// out, otherwise the ticket reads "awaiting approval" forever.
describe("statusChangeData: cancelling a request awaiting approval", () => {
  it("withdraws the pending approval", () => {
    const patch = statusChangeData({ ...clock, status: "NEW", approvalState: "PENDING" }, "CANCELLED", now);
    expect(patch.approvalState).toBe("CANCELLED");
  });

  it.each([null, undefined, "APPROVED", "REJECTED", "CANCELLED"])("leaves approvalState %s alone", (approvalState) => {
    const patch = statusChangeData({ ...clock, status: "OPEN", approvalState }, "CANCELLED", now);
    expect(patch).not.toHaveProperty("approvalState");
  });

  it.each(["OPEN", "RESOLVED", "CLOSED", "PENDING"])("does not touch approvalState when moving to %s", (to) => {
    const patch = statusChangeData({ ...clock, status: "NEW", approvalState: "PENDING" }, to, now);
    expect(patch).not.toHaveProperty("approvalState");
  });
});

describe("approval status constants", () => {
  it("every approval status has a badge entry, including CANCELLED", () => {
    expect(APPROVAL_STATUSES).toContain("CANCELLED");
    for (const status of APPROVAL_STATUSES) expect(APPROVAL_META[status]).toBeDefined();
  });
});
