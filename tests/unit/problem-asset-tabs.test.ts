import { describe, expect, it } from "vitest";
import { resolveTab } from "@/lib/entity-tabs";
import { buildProblemTabs, DEFAULT_PROBLEM_TAB } from "@/components/problems/tabs/problem-tabs";
import { buildAssetTabs, DEFAULT_ASSET_TAB } from "@/components/assets/tabs/asset-tabs";

describe("buildProblemTabs", () => {
  const tabs = buildProblemTabs({ incidents: 3, changes: 1, affectedCis: 2, comments: 0 }, true);

  it("lists the sections in reading order", () => {
    expect(tabs.map((t) => t.key)).toEqual([
      "overview", "incidents", "changes", "impact", "discussion", "history",
    ]);
  });

  it("carries the linked-record, affected-CI and comment counts", () => {
    const counts = Object.fromEntries(tabs.map((t) => [t.key, t.count]));
    expect(counts).toMatchObject({ incidents: 3, changes: 1, impact: 2, discussion: 0 });
  });

  it("resolves ?tab= and falls back to the overview", () => {
    expect(resolveTab({ tab: "changes" }, tabs, DEFAULT_PROBLEM_TAB)).toBe("changes");
    expect(resolveTab({ tab: "bogus" }, tabs, DEFAULT_PROBLEM_TAB)).toBe("overview");
  });

  it("hides the affected-CI tab from non-agents", () => {
    const userTabs = buildProblemTabs({ incidents: 0, changes: 0, affectedCis: 2, comments: 0 }, false);
    expect(userTabs.find((t) => t.key === "impact")?.hidden).toBe(true);
    expect(resolveTab({ tab: "impact" }, userTabs, DEFAULT_PROBLEM_TAB)).toBe("overview");
  });
});

describe("buildAssetTabs", () => {
  const tabs = buildAssetTabs({ relations: 4, tickets: 2, changes: 3 });

  it("lists the sections in reading order", () => {
    expect(tabs.map((t) => t.key)).toEqual([
      "overview", "relationships", "work", "contracts", "history",
    ]);
  });

  it("counts relations, and tickets plus changes together", () => {
    const counts = Object.fromEntries(tabs.map((t) => [t.key, t.count]));
    expect(counts).toMatchObject({ relationships: 4, work: 5 });
  });

  it("resolves ?tab= and falls back to the overview", () => {
    expect(resolveTab({ tab: "contracts" }, tabs, DEFAULT_ASSET_TAB)).toBe("contracts");
    expect(resolveTab({}, tabs, DEFAULT_ASSET_TAB)).toBe("overview");
  });
});
