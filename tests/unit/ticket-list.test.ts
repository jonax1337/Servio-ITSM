import { describe, expect, it } from "vitest";
import { ticketListQuery, TICKET_LIST_PARAMS } from "@/lib/ticket-list";

// The ticket list page and its "Export CSV" must apply the SAME filters and sort,
// otherwise an export silently contains rows the agent never saw on screen.
describe("ticketListQuery", () => {
  it("applies the list filters from the URL", () => {
    const { where } = ticketListQuery({ priority: "CRITICAL", status: "OPEN" });
    expect(JSON.stringify(where)).toContain("CRITICAL");
    expect(JSON.stringify(where)).toContain("OPEN");
  });

  it("applies the requested sort and falls back to newest activity", () => {
    expect(ticketListQuery({ sort: "createdAt", dir: "asc" }).orderBy).toEqual({ createdAt: "asc" });
    expect(ticketListQuery({}).orderBy).toEqual({ updatedAt: "desc" });
    expect(ticketListQuery({ sort: "bogus" }).orderBy).toEqual({ updatedAt: "desc" });
  });

  it("forwards every filter the list understands to the export", () => {
    for (const key of ["q", "status", "priority", "impact", "urgency", "source", "major", "vip", "breached", "sort", "dir"]) {
      expect(TICKET_LIST_PARAMS, key).toContain(key);
    }
  });
});

describe("ticketListQuery SLA view", () => {
  it("narrows the list to the tickets in the SLA view", () => {
    const { where } = ticketListQuery({ status: "open" }, { id: { in: [4, 9] } });
    expect(JSON.stringify(where)).toContain('"id":{"in":[4,9]}');
    expect(JSON.stringify(where)).toContain("NEW");
  });

  it("keeps an empty SLA view empty instead of showing every ticket", () => {
    expect(JSON.stringify(ticketListQuery({}, { id: { in: [] } }).where)).toContain('"id":{"in":[]}');
  });

  it("forwards the sla param to the export", () => {
    expect(TICKET_LIST_PARAMS).toContain("sla");
  });
});

describe("ticketListQuery SLA sort", () => {
  it("sorts by SLA urgency, most urgent first by default for the column", () => {
    expect(ticketListQuery({ sort: "sla", dir: "asc" }).slaSort).toEqual({ dir: "asc" });
    expect(ticketListQuery({ sort: "sla", dir: "desc" }).slaSort).toEqual({ dir: "desc" });
  });

  it("does not sort by SLA for any other sort", () => {
    expect(ticketListQuery({ sort: "priority" }).slaSort).toBeUndefined();
    expect(ticketListQuery({}).slaSort).toBeUndefined();
  });
});
