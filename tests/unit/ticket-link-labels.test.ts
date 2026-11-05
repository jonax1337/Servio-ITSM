import { describe, expect, it } from "vitest";
import { ticketLinkEntries, ticketLinkLabel } from "@/lib/ticket-link-labels";

// Mirrors TICKET_LINK_TYPES in lib/ticket-core.ts (server-only, so not importable here).
const LINK_TYPES = ["RELATED", "DUPLICATE", "BLOCKS", "CAUSED_BY"];

describe("ticketLinkLabel", () => {
  it.each([
    ["BLOCKS", "source", "Blocks"],
    ["BLOCKS", "target", "Blocked by"],
    ["DUPLICATE", "source", "Duplicate of"],
    ["DUPLICATE", "target", "Has duplicate"],
    ["CAUSED_BY", "source", "Caused by"],
    ["CAUSED_BY", "target", "Causes"],
    ["RELATED", "source", "Related to"],
    ["RELATED", "target", "Related to"],
  ] as const)("%s seen from the %s reads %s", (type, side, label) => {
    expect(ticketLinkLabel(type, side)).toBe(label);
  });

  it("labels every link type on both sides", () => {
    for (const type of LINK_TYPES) {
      expect(ticketLinkLabel(type, "source")).not.toBe(type);
      expect(ticketLinkLabel(type, "target")).not.toBe(type);
    }
  });

  it("falls back to the raw type for an unknown type", () => {
    expect(ticketLinkLabel("SUPERSEDES", "target")).toBe("SUPERSEDES");
  });
});

describe("ticketLinkEntries", () => {
  const a = { id: 1, title: "A", prefix: "INC" };
  const b = { id: 2, title: "B", prefix: "INC" };
  const c = { id: 3, title: "C", prefix: "REQ" };

  it("points outgoing links at the target ticket with the source label", () => {
    expect(ticketLinkEntries([{ id: "l1", type: "BLOCKS", linked: b }], [])).toEqual([
      { linkId: "l1", ticket: b, label: "Blocks" },
    ]);
  });

  it("points incoming links at the source ticket with the inverse label", () => {
    expect(ticketLinkEntries([], [{ id: "l2", type: "BLOCKS", ticket: c }])).toEqual([
      { linkId: "l2", ticket: c, label: "Blocked by" },
    ]);
  });

  it("lists outgoing links before incoming ones", () => {
    const entries = ticketLinkEntries(
      [{ id: "l1", type: "RELATED", linked: b }],
      [{ id: "l2", type: "DUPLICATE", ticket: a }],
    );
    expect(entries.map((e) => e.linkId)).toEqual(["l1", "l2"]);
    expect(entries[1].label).toBe("Has duplicate");
  });

  it("returns nothing when there are no links", () => {
    expect(ticketLinkEntries([], [])).toEqual([]);
  });
});
