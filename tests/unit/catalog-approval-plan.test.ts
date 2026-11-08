import { describe, expect, it } from "vitest";
import { APPROVER_UNAVAILABLE, NO_APPROVER_CONFIGURED, catalogApprovalPlan } from "@/lib/service-forms";

const groupFirst = JSON.stringify([{ groupId: "g1" }, { approverId: "u2" }]);

describe("catalogApprovalPlan", () => {
  it("needs no stages for an item without approval", () => {
    expect(catalogApprovalPlan({ requiresApproval: false, approverId: null }, false)).toEqual({ stages: [] });
  });

  it("accepts a group-only first stage without a mirrored approverId", () => {
    expect(catalogApprovalPlan({ requiresApproval: true, approvalStages: groupFirst, approverId: null }, true)).toEqual({
      stages: [{ approverId: null, groupId: "g1" }, { approverId: "u2", groupId: null }],
    });
  });

  it("does not depend on the mirrored approverId when the group still has an approver", () => {
    const plan = catalogApprovalPlan({ requiresApproval: true, approvalStages: groupFirst, approverId: "gone" }, true);
    expect("stages" in plan && plan.stages[0]).toEqual({ approverId: null, groupId: "g1" });
  });

  it("falls back to the legacy single approver", () => {
    expect(catalogApprovalPlan({ requiresApproval: true, approvalStages: null, approverId: "u1" }, true)).toEqual({
      stages: [{ approverId: "u1", groupId: null }],
    });
  });

  it("refuses an item with approval but neither stages nor approver", () => {
    expect(catalogApprovalPlan({ requiresApproval: true, approvalStages: null, approverId: null }, false)).toEqual({ error: NO_APPROVER_CONFIGURED });
  });

  it("refuses when nobody can take the first stage", () => {
    expect(catalogApprovalPlan({ requiresApproval: true, approvalStages: groupFirst, approverId: null }, false)).toEqual({ error: APPROVER_UNAVAILABLE });
  });
});
