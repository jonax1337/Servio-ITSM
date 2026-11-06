import { describe, expect, it } from "vitest";
import { resolveTab, tabHref, type EntityTab } from "@/lib/entity-tabs";

type Key = "conversation" | "details" | "work";

const TABS: EntityTab<Key>[] = [
  { key: "conversation", label: "Conversation" },
  { key: "details", label: "Details" },
  { key: "work", label: "Work", hidden: true },
];

describe("resolveTab", () => {
  it("returns the requested tab when it is visible", () => {
    expect(resolveTab({ tab: "details" }, TABS, "conversation")).toBe("details");
  });

  it("falls back to the default without a ?tab= param", () => {
    expect(resolveTab({}, TABS, "conversation")).toBe("conversation");
  });

  it("falls back for an unknown tab key", () => {
    expect(resolveTab({ tab: "nope" }, TABS, "conversation")).toBe("conversation");
  });

  it("never resolves a hidden tab, even when requested", () => {
    expect(resolveTab({ tab: "work" }, TABS, "conversation")).toBe("conversation");
  });

  it("uses the first value of a repeated ?tab= param", () => {
    expect(resolveTab({ tab: ["details", "conversation"] }, TABS, "conversation")).toBe("details");
  });
});

describe("tabHref", () => {
  it("sets ?tab= and keeps the other search params", () => {
    expect(tabHref("/tickets/7", { page: "2" }, "details", "conversation")).toBe(
      "/tickets/7?page=2&tab=details",
    );
  });

  it("drops ?tab= for the default tab", () => {
    expect(tabHref("/tickets/7", { tab: "details" }, "conversation", "conversation")).toBe("/tickets/7");
  });
});
