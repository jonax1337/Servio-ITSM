import { describe, expect, it } from "vitest";
import { resolveTab } from "@/lib/entity-tabs";
import { buildServiceTabs, DEFAULT_SERVICE_TAB } from "@/components/services/tabs/service-tabs";

describe("buildServiceTabs", () => {
  const tabs = buildServiceTabs({ openTickets: 2, configuration: 5, catalogItems: 1, pendingApprovals: 0 });

  it("lists the sections in reading order", () => {
    expect(tabs.map((t) => t.key)).toEqual(["overview", "configuration", "catalog", "approvals", "history"]);
  });

  it("carries the open-ticket, configuration, catalog and pending-approval counts", () => {
    expect(Object.fromEntries(tabs.map((t) => [t.key, t.count]))).toEqual({
      overview: 2, configuration: 5, catalog: 1, approvals: 0, history: undefined,
    });
  });

  it("resolves ?tab= and falls back to the overview", () => {
    expect(resolveTab({ tab: "configuration" }, tabs, DEFAULT_SERVICE_TAB)).toBe("configuration");
    expect(resolveTab({ tab: "bogus" }, tabs, DEFAULT_SERVICE_TAB)).toBe("overview");
  });
});
