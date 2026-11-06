import { describe, expect, it } from "vitest";
import { AFFECTED_CI_SEARCH_LIMIT, affectedCiSearchWhere } from "@/lib/affected-ci-search";

const inService = { status: { notIn: ["RETIRED", "DISPOSED"] } };

describe("affectedCiSearchWhere", () => {
  it("offers every in-service asset when nothing was typed", () => {
    expect(affectedCiSearchWhere("")).toEqual(inService);
    expect(affectedCiSearchWhere("   ")).toEqual(inService);
  });

  it("matches the name, the asset tag and the serial", () => {
    expect(affectedCiSearchWhere(" srv-01 ")).toEqual({
      ...inService,
      OR: [{ name: { contains: "srv-01" } }, { assetTag: { contains: "srv-01" } }, { serial: { contains: "srv-01" } }],
    });
  });

  it("caps the typed text", () => {
    const where = affectedCiSearchWhere("x".repeat(500));
    expect(JSON.stringify(where)).not.toContain("x".repeat(81));
  });

  it("offers at most 20 matches", () => {
    expect(AFFECTED_CI_SEARCH_LIMIT).toBe(20);
  });
});
