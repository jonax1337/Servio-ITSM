import { describe, expect, it } from "vitest";
import { canAttachToChange, SETTLED_CHANGE_STATUSES } from "@/lib/asset-link-rules";
import { ASSET_STATUSES, CHANGE_STATUSES } from "@/lib/constants";

describe("canAttachToChange", () => {
  it("refuses retired and disposed assets", () => {
    expect(canAttachToChange("RETIRED")).toBe(false);
    expect(canAttachToChange("DISPOSED")).toBe(false);
  });

  it("accepts every other known asset status", () => {
    for (const status of ASSET_STATUSES.filter((s) => s !== "RETIRED" && s !== "DISPOSED")) {
      expect(canAttachToChange(status)).toBe(true);
    }
  });
});

describe("SETTLED_CHANGE_STATUSES", () => {
  it("only names real change statuses", () => {
    for (const status of SETTLED_CHANGE_STATUSES) expect(CHANGE_STATUSES).toContain(status);
  });
});
