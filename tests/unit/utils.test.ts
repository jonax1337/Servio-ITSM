import { describe, expect, it } from "vitest";
import { distinctIds } from "@/lib/utils";

describe("distinctIds", () => {
  it("keeps the chosen order and drops duplicates and blanks", () => {
    expect(distinctIds(["g2", " g1 ", "g2", "", "  "])).toEqual(["g2", "g1"]);
  });

  it("is empty when nothing was chosen", () => {
    expect(distinctIds([])).toEqual([]);
  });
});
