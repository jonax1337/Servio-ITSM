import { describe, expect, it } from "vitest";
import { buildBulkChanges, bulkSummary } from "@/lib/bulk-edit";

describe("buildBulkChanges", () => {
  it("returns nothing when no field is set", () => {
    expect(buildBulkChanges({})).toEqual([]);
    expect(buildBulkChanges({ status: "", priority: "" })).toEqual([]);
  });

  it("applies the group before the assignee, whatever order the form posted", () => {
    expect(buildBulkChanges({ assigneeId: "u1", groupId: "g1" })).toEqual([
      { field: "groupId", value: "g1" },
      { field: "assigneeId", value: "u1" },
    ]);
  });

  it("collects every field of a combined edit in application order", () => {
    expect(buildBulkChanges({ status: "IN_PROGRESS", priority: "HIGH", categoryId: "c1", assigneeId: "u1", groupId: "g1" }))
      .toEqual([
        { field: "groupId", value: "g1" },
        { field: "assigneeId", value: "u1" },
        { field: "categoryId", value: "c1" },
        { field: "priority", value: "HIGH" },
        { field: "status", value: "IN_PROGRESS" },
      ]);
  });

  it("lets group, assignee and category be cleared with 'none'", () => {
    expect(buildBulkChanges({ groupId: "none", assigneeId: "none", categoryId: "none" })).toEqual([
      { field: "groupId", value: "none" },
      { field: "assigneeId", value: "none" },
      { field: "categoryId", value: "none" },
    ]);
  });

  it("does not let priority or status be cleared", () => {
    expect(buildBulkChanges({ priority: "none", status: "none" })).toEqual([]);
  });

  it("drops statuses that need a reason or note", () => {
    expect(buildBulkChanges({ status: "PENDING" })).toEqual([]);
    expect(buildBulkChanges({ status: "ON_HOLD" })).toEqual([]);
    expect(buildBulkChanges({ status: "CANCELLED" })).toEqual([]);
  });

  it("drops off-list priorities and unknown fields", () => {
    expect(buildBulkChanges({ priority: "URGENT-ISH", requesterId: "u9", title: "x" })).toEqual([]);
  });

  it("ignores a patch that is not an object", () => {
    expect(buildBulkChanges(null)).toEqual([]);
    expect(buildBulkChanges("status=OPEN")).toEqual([]);
  });
});

describe("bulkSummary", () => {
  it("reports a complete bulk edit", () => {
    expect(bulkSummary({ updated: 5, failed: 0 })).toBe("5 tickets updated");
  });

  it("uses the singular for one ticket", () => {
    expect(bulkSummary({ updated: 1, failed: 0 })).toBe("1 ticket updated");
  });

  it("reports tickets that could not be changed", () => {
    expect(bulkSummary({ updated: 3, failed: 2 })).toBe("3 tickets updated, 2 not changed");
    expect(bulkSummary({ updated: 0, failed: 2 })).toBe("2 tickets not changed");
  });
});
