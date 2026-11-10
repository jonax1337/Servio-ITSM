import { describe, expect, it } from "vitest";
import { resolveTab } from "@/lib/entity-tabs";
import { buildPersonTabs, DEFAULT_PERSON_TAB } from "@/components/people/person-tabs";

describe("buildPersonTabs", () => {
  const tabs = buildPersonTabs({ openTickets: 3, assets: 2, groups: 1 });

  it("lists the sections with their counts", () => {
    expect(tabs.map((t) => [t.key, t.count])).toEqual([["tickets", 3], ["assets", 2], ["groups", 1]]);
  });

  it("resolves ?tab= and falls back to the open tickets", () => {
    expect(resolveTab({ tab: "groups" }, tabs, DEFAULT_PERSON_TAB)).toBe("groups");
    expect(resolveTab({ tab: "bogus" }, tabs, DEFAULT_PERSON_TAB)).toBe("tickets");
  });
});
