import { describe, expect, it } from "vitest";
import { SAVED_VIEW_KEYS, sanitizeFilters } from "@/lib/saved-view-filters";
import { SLA_VIEWS } from "@/lib/sla-views";
import { TICKET_LIST_PARAMS } from "@/lib/ticket-list";

describe("ticket saved views", () => {
  it("can store every filter the SavedViewsBar captures on /tickets", () => {
    const sentByBar = SAVED_VIEW_KEYS.ticket;
    expect(sentByBar).toContain("sla");
    for (const key of sentByBar) expect(TICKET_LIST_PARAMS as readonly string[]).toContain(key);
  });

  it("keeps an SLA view when it is saved", () => {
    for (const view of SLA_VIEWS) {
      expect(JSON.parse(sanitizeFilters(JSON.stringify({ sla: view, status: "OPEN" }), "ticket"))).toEqual({ sla: view, status: "OPEN" });
    }
  });

  it("drops params a view may not carry", () => {
    expect(JSON.parse(sanitizeFilters('{"sort":"id","status":"all","q":" "}', "ticket"))).toEqual({});
  });
});
