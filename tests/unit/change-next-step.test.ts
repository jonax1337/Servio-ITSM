import { describe, expect, it } from "vitest";
import { changeNextStep, type NextStepInput } from "@/components/changes/tabs/next-step";

const input = (overrides: Partial<NextStepInput>): NextStepInput => ({
  status: "DRAFT",
  type: "NORMAL",
  preAuthorized: false,
  submitBlockers: [],
  freezeNames: [],
  seatedApprovers: 0,
  pendingApprovals: 0,
  ...overrides,
});

describe("changeNextStep", () => {
  it("sends a draft with missing plans to Planning and names what is missing", () => {
    const step = changeNextStep(input({ submitBlockers: ["a rollback plan", "a planned window (start and end)"] }));
    expect(step?.tab?.key).toBe("planning");
    expect(step?.detail).toContain("a rollback plan, a planned window (start and end)");
  });

  it("tells a complete normal draft to submit and points at the CAB", () => {
    const step = changeNextStep(input({}));
    expect(step?.title).toBe("Ready to submit for approval");
    expect(step?.tab?.key).toBe("cab");
  });

  it("tells a complete standard draft that submitting approves it, with no CAB to visit", () => {
    const step = changeNextStep(input({ type: "STANDARD", preAuthorized: true }));
    expect(step?.detail).toContain("straight to Approved");
    expect(step?.tab).toBeUndefined();
  });

  it("warns a normal draft whose window sits in a freeze, but lets an emergency change through", () => {
    const frozen = { freezeNames: ["Black Friday freeze"] };
    const normal = changeNextStep(input(frozen));
    expect(normal?.title).toBe("Move the planned window out of the freeze");
    expect(normal?.detail).toContain("Black Friday freeze");
    expect(normal?.tab?.key).toBe("planning");
    expect(changeNextStep(input({ ...frozen, type: "EMERGENCY" }))?.title).toBe("Ready to submit for approval");
  });

  it("reports missing plans before a freeze", () => {
    const step = changeNextStep(input({ freezeNames: ["Black Friday freeze"], submitBlockers: ["a rollback plan"] }));
    expect(step?.title).toBe("Complete the plan to submit");
  });

  it("asks for approvers when the board is empty, and counts the waiting ones otherwise", () => {
    expect(changeNextStep(input({ status: "APPROVAL" }))?.title).toBe("Seat approvers");
    expect(changeNextStep(input({ status: "APPROVAL", seatedApprovers: 2, pendingApprovals: 1 }))?.title).toBe("Waiting for 1 approver");
    expect(changeNextStep(input({ status: "APPROVAL", seatedApprovers: 3, pendingApprovals: 2 }))?.title).toBe("Waiting for 2 approvers");
  });

  it("names the next status move for every working status", () => {
    for (const status of ["APPROVED", "SCHEDULED", "IN_PROGRESS", "REVIEW", "FAILED", "REJECTED"]) {
      expect(changeNextStep(input({ status }))?.detail, status).toBeTruthy();
    }
  });

  it("has nothing to suggest once the change is closed or cancelled", () => {
    expect(changeNextStep(input({ status: "CLOSED" }))).toBeNull();
    expect(changeNextStep(input({ status: "CANCELLED" }))).toBeNull();
  });
});
