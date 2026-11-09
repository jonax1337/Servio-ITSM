import { describe, expect, it } from "vitest";
import { apiFieldNames, changedColumns } from "@/lib/api-record-diff";

describe("changedColumns", () => {
  it("lists only the columns whose value differs", () => {
    const current = { name: "A", notes: null, endDate: new Date("2026-01-01T00:00:00Z"), isActive: true };
    expect(changedColumns(current, { name: "A", notes: null, endDate: new Date("2026-01-01T00:00:00Z") })).toEqual([]);
    expect(changedColumns(current, { name: "B", notes: undefined, isActive: false })).toEqual(["name", "isActive"]);
    expect(changedColumns(current, { endDate: null })).toEqual(["endDate"]);
  });
});

describe("apiFieldNames", () => {
  it("snake_cases columns and applies renames", () => {
    expect(apiFieldNames(["renewalNoticeDays", "isActive", "name"], { isActive: "active" })).toEqual(["renewal_notice_days", "active", "name"]);
  });
});
