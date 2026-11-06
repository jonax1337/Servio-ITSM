import { describe, expect, it } from "vitest";
import {
  buildChangeTabs,
  changeLinkCount,
  CHANGE_TAB_KEYS,
  DEFAULT_CHANGE_TAB,
  type ChangeTabCounts,
} from "@/components/changes/tabs/change-tabs";

const NO_COUNTS: ChangeTabCounts = { pendingApprovals: 0, affectedCis: 0, links: 0, comments: 0 };

const tab = (tabs: ReturnType<typeof buildChangeTabs>, key: string) => tabs.find((t) => t.key === key);

describe("buildChangeTabs", () => {
  it("lists every tab in order and starts on the default", () => {
    const tabs = buildChangeTabs({ status: "DRAFT", submitBlockers: [], counts: NO_COUNTS });
    expect(tabs.map((t) => t.key)).toEqual([...CHANGE_TAB_KEYS]);
    expect(tabs[0].key).toBe(DEFAULT_CHANGE_TAB);
  });

  it("warns on Planning for a draft that cannot be submitted yet, naming what is missing", () => {
    const tabs = buildChangeTabs({ status: "DRAFT", submitBlockers: ["a rollback plan", "a planned window"], counts: NO_COUNTS });
    expect(tab(tabs, "planning")?.warning).toBe("Missing: a rollback plan, a planned window");
  });

  it("does not warn on a complete draft", () => {
    const tabs = buildChangeTabs({ status: "DRAFT", submitBlockers: [], counts: NO_COUNTS });
    expect(tab(tabs, "planning")?.warning).toBeUndefined();
  });

  it("does not warn once the change has left draft", () => {
    const tabs = buildChangeTabs({ status: "APPROVAL", submitBlockers: ["a rollback plan"], counts: { ...NO_COUNTS, pendingApprovals: 1 } });
    expect(tab(tabs, "planning")?.warning).toBeUndefined();
  });

  it("puts each count on its own tab and nowhere else", () => {
    const tabs = buildChangeTabs({
      status: "APPROVAL",
      submitBlockers: [],
      counts: { pendingApprovals: 3, affectedCis: 2, links: 5, comments: 4 },
    });
    expect(tab(tabs, "cab")?.count).toBe(3);
    expect(tab(tabs, "impact")?.count).toBe(2);
    expect(tab(tabs, "links")?.count).toBe(5);
    expect(tab(tabs, "discussion")?.count).toBe(4);
    expect(tabs.filter((t) => t.count !== undefined).map((t) => t.key)).toEqual(["cab", "impact", "links", "discussion"]);
  });
});

describe("changeLinkCount", () => {
  it("counts the problem, tickets and affected CIs the Links tab lists", () => {
    expect(changeLinkCount({ hasProblem: true, tickets: 2, assets: 3 })).toBe(6);
    expect(changeLinkCount({ hasProblem: false, tickets: 0, assets: 0 })).toBe(0);
  });
});
