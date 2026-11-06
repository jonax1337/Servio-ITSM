import { describe, expect, it } from "vitest";
import {
  CHANGE_SELF_APPROVAL_ERROR,
  approvalTabs,
  changeSelfApprovalError,
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
