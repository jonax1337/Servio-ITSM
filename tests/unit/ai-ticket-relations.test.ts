import { describe, expect, it } from "vitest";
import {
  isNoParent,
  mergeLabel,
  refFor,
  relationLines,
  setParentLabel,
  ticketRelations,
  unmergeLabel,
  type TicketRelationsRow,
} from "@/lib/ai-operations/ticket-relations";

const related = (id: number, over: Partial<{ type: string; prefix: string | null; title: string; status: string }> = {}) => ({
  id,
  type: "INCIDENT",
  prefix: "INC",
  title: `Ticket ${id}`,
  status: "OPEN",
  ...over,
});

const row = (over: Partial<TicketRelationsRow> = {}): TicketRelationsRow => ({
  parent: null,
  children: [],
  mergedInto: null,
  _count: { children: 0, mergedTickets: 0 },
  ...over,
});

describe("refFor", () => {
  it("uses the stored prefix, which survives a type switch", () => {
    expect(refFor({ id: 7, type: "REQUEST", prefix: "INC" })).toBe("INC-0007");
  });

  it("falls back to the type when no prefix is loaded", () => {
    expect(refFor({ id: 7, type: "REQUEST" })).toBe("REQ-0007");
  });
});

describe("isNoParent", () => {
  it("recognises 'none' in any case with surrounding space", () => {
    expect(isNoParent(" None ")).toBe(true);
  });

  it("does not treat a ref, a number or nothing as a request to detach", () => {
    expect(isNoParent("INC-0042")).toBe(false);
    expect(isNoParent("42")).toBe(false);
    expect(isNoParent(undefined)).toBe(false);
  });
});

describe("approval card labels", () => {
  it("states the direction of a parent link and of a detach", () => {
    expect(setParentLabel("INC-0043", "INC-0042")).toBe("Make INC-0043 a child of INC-0042");
    expect(setParentLabel("INC-0043", "none")).toBe("Detach INC-0043 from its parent ticket");
  });

  it("spells out what a merge copies and moves, which ticket is cancelled and that it can be undone", () => {
    const label = mergeLabel("INC-0043", "INC-0042");
    for (const copied of ["comments", "watchers", "linked assets", "ticket links"]) {
      expect(label).toContain(copied);
    }
    expect(label).toContain("copied to INC-0042");
    expect(label).toContain("attachments and child tickets are moved");
    expect(label).toContain("adopts its problem/change if it has none");
    expect(label).toContain("pending approvals are withdrawn");
    expect(label).toContain("INC-0043 is cancelled");
    expect(label).toContain("undone");
  });

  it("names the ticket an undo restores", () => {
    expect(unmergeLabel("INC-0043")).toContain("INC-0043");
  });
});

describe("ticketRelations", () => {
  it("reports no relations for a plain ticket", () => {
    expect(ticketRelations(row())).toEqual({
      parent: null,
      childCount: 0,
      children: [],
      mergedInto: null,
      mergedTicketCount: 0,
    });
  });

  it("describes the parent and lists children with the full child count", () => {
    const result = ticketRelations(
      row({
        parent: related(1, { title: "Outage", status: "IN_PROGRESS" }),
        children: [related(2), related(3, { type: "REQUEST", prefix: "REQ", status: "RESOLVED" })],
        _count: { children: 12, mergedTickets: 0 },
      }),
    );
    expect(result.parent).toEqual({ ref: "INC-0001", title: "Outage", status: "IN_PROGRESS" });
    expect(result.children.map((c) => c.ref)).toEqual(["INC-0002", "REQ-0003"]);
    expect(result.childCount).toBe(12);
  });

  it("reports the ticket a merged ticket went into and how many were merged into this one", () => {
    expect(ticketRelations(row({ mergedInto: related(9, { status: "CANCELLED" }) })).mergedInto).toEqual({
      ref: "INC-0009",
      title: "Ticket 9",
      status: "CANCELLED",
    });
    expect(ticketRelations(row({ _count: { children: 0, mergedTickets: 3 } })).mergedTicketCount).toBe(3);
  });
});

describe("relationLines", () => {
  it("is empty for a plain ticket", () => {
    expect(relationLines(row())).toEqual([]);
  });

  it("names the parent, the sub-tickets and how many more are not listed", () => {
    const lines = relationLines(
      row({
        parent: related(1, { title: "Outage", status: "IN_PROGRESS" }),
        children: [related(2), related(3)],
        _count: { children: 12, mergedTickets: 0 },
      }),
    );
    expect(lines).toEqual([
      'Parent ticket: INC-0001 "Outage" (IN_PROGRESS)',
      'Sub-tickets (12): INC-0002 "Ticket 2" (OPEN); INC-0003 "Ticket 3" (OPEN); and 10 more',
    ]);
  });

  it("tells the model a merged ticket needs an unmerge, not a status change", () => {
    const [line] = relationLines(row({ mergedInto: related(9, { status: "OPEN" }) }));
    expect(line).toContain('Merged into INC-0009 "Ticket 9" (OPEN)');
    expect(line).toContain("ticket.unmerge");
  });

  it("counts the duplicates merged into a ticket", () => {
    expect(relationLines(row({ _count: { children: 0, mergedTickets: 3 } }))).toEqual([
      "Duplicates merged into this ticket: 3",
    ]);
  });
});
