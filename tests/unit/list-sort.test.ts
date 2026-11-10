import { describe, expect, it } from "vitest";
import { listSort } from "@/lib/query";

const KEYS = ["id", "name", "updatedAt"] as const;
const DEFAULT = { sort: "name", dir: "asc" } as const;

describe("listSort", () => {
  it("uses the page default, with its own direction, when the URL names no sort", () => {
    expect(listSort({}, KEYS, DEFAULT)).toEqual({ sort: "name", dir: "asc" });
  });

  it("ignores a sort key the page does not offer", () => {
    expect(listSort({ sort: "bogus", dir: "desc" }, KEYS, DEFAULT)).toEqual({ sort: "name", dir: "asc" });
  });

  it("takes a known sort from the URL, descending unless asked otherwise", () => {
    expect(listSort({ sort: "updatedAt" }, KEYS, DEFAULT)).toEqual({ sort: "updatedAt", dir: "desc" });
    expect(listSort({ sort: "id", dir: "asc" }, KEYS, DEFAULT)).toEqual({ sort: "id", dir: "asc" });
  });
});
