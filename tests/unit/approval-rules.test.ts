import { describe, expect, it } from "vitest";
import {
  ALREADY_DECIDED_ERROR,
  CHANGE_SELF_APPROVAL_ERROR,
  NOT_THE_APPROVER_ERROR,
  REQUEST_SELF_APPROVAL_ERROR,
  approvalTabs,
  changeSelfApprovalError,
  decisionRefusal,
  requestSelfApprovalError,
  tabShowsSection,
} from "@/lib/approval-rules";
import { resolveTab } from "@/lib/entity-tabs";

describe("changeSelfApprovalError (four-eyes)", () => {
  const change = { createdById: "requester", assigneeId: "owner" };

  it("refuses the person who requested the change", () => {
    expect(changeSelfApprovalError(change, "requester")).toBe(CHANGE_SELF_APPROVAL_ERROR);
  });

  it("refuses the owner of the change", () => {
    expect(changeSelfApprovalError(change, "owner")).toBe(CHANGE_SELF_APPROVAL_ERROR);
  });

  it("lets any other approver decide", () => {
    expect(changeSelfApprovalError(change, "cab-member")).toBeNull();
  });

  it("does not mistake an unset creator or owner for the approver", () => {
    expect(changeSelfApprovalError({ createdById: null, assigneeId: null }, "cab-member")).toBeNull();
  });

  it("explains the rule in the message the UI shows", () => {
    expect(CHANGE_SELF_APPROVAL_ERROR).toMatch(/requested or own/);
    expect(CHANGE_SELF_APPROVAL_ERROR).toMatch(/Another approver/);
  });
});

describe("approval inbox tabs", () => {
  const counts = { changes: 2, requests: 15, other: 1 };

  it("counts every pending approval under All and each kind under its own tab", () => {
    expect(approvalTabs(counts).map((t) => [t.key, t.count])).toEqual([
      ["all", 18],
      ["changes", 2],
      ["requests", 15],
      ["other", 1],
    ]);
  });

  it("shows every section under All and only its own under a specific tab", () => {
    expect(tabShowsSection("all", "changes")).toBe(true);
    expect(tabShowsSection("all", "other")).toBe(true);
    expect(tabShowsSection("changes", "changes")).toBe(true);
    expect(tabShowsSection("changes", "requests")).toBe(false);
    expect(tabShowsSection("other", "requests")).toBe(false);
  });

  it("falls back to All for an unknown ?tab= value", () => {
    const tabs = approvalTabs(counts);
    expect(resolveTab({ tab: "changes" }, tabs, "all")).toBe("changes");
    expect(resolveTab({ tab: "bogus" }, tabs, "all")).toBe("all");
    expect(resolveTab({}, tabs, "all")).toBe("all");
  });
});

describe("decisionRefusal (catalog requests and sign-offs)", () => {
  const pending = { status: "PENDING", approverId: "approver", requesterId: "requester" };
  const agent = (id: string) => ({ id, role: "AGENT" });

  it("lets the assigned approver decide a pending request", () => {
    expect(decisionRefusal(pending, agent("approver"))).toBeNull();
  });

  it("lets an admin decide on behalf of the approver", () => {
    expect(decisionRefusal(pending, { id: "admin", role: "ADMIN" })).toBeNull();
  });

  it("refuses someone who is not the approver", () => {
    expect(decisionRefusal(pending, agent("bystander"))).toBe(NOT_THE_APPROVER_ERROR);
  });

  it("refuses the requester even when they are the assigned approver", () => {
    expect(decisionRefusal({ ...pending, approverId: "requester" }, agent("requester"))).toBe(REQUEST_SELF_APPROVAL_ERROR);
  });

  it("refuses the requester even as admin", () => {
    expect(decisionRefusal(pending, { id: "requester", role: "ADMIN" })).toBe(REQUEST_SELF_APPROVAL_ERROR);
  });

  it.each(["APPROVED", "REJECTED"])("refuses a request that is already %s", (status) => {
    expect(decisionRefusal({ ...pending, status }, agent("approver"))).toBe(ALREADY_DECIDED_ERROR);
  });

  it("does not mistake an unknown requester for the approver", () => {
    expect(decisionRefusal({ ...pending, requesterId: null }, agent("approver"))).toBeNull();
    expect(requestSelfApprovalError(null, "approver")).toBeNull();
  });
});
