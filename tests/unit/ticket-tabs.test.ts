import { describe, expect, it } from "vitest";
import { resolveTab } from "@/lib/entity-tabs";
import { DEFAULT_TICKET_TAB, ticketLinkCount, ticketTabs, type TicketTabCounts } from "@/components/tickets/tabs/ticket-tabs";

const COUNTS: TicketTabCounts = { comments: 4, links: 2, openTasks: 1, pendingApprovals: 3, details: 5 };

describe("ticketTabs", () => {
  it("shows every tab to agents with their counts", () => {
    const tabs = ticketTabs(COUNTS, true);
    expect(tabs.filter((t) => t.hidden)).toEqual([]);
    expect(Object.fromEntries(tabs.map((t) => [t.key, t.count]))).toEqual({
      conversation: 4, details: 5, links: 2, work: 1, approvals: 3, history: undefined,
    });
  });

  it("hides the agent-only tabs from everyone else", () => {
    const hidden = ticketTabs(COUNTS, false).filter((t) => t.hidden).map((t) => t.key);
    expect(hidden).toEqual(["work", "approvals"]);
  });

  it("does not let a non-agent open an agent-only tab through ?tab=", () => {
    const tabs = ticketTabs(COUNTS, false);
    expect(resolveTab({ tab: "work" }, tabs, DEFAULT_TICKET_TAB)).toBe("conversation");
    expect(resolveTab({ tab: "approvals" }, tabs, DEFAULT_TICKET_TAB)).toBe("conversation");
  });

  it("opens agent-only tabs for agents", () => {
    expect(resolveTab({ tab: "work" }, ticketTabs(COUNTS, true), DEFAULT_TICKET_TAB)).toBe("work");
  });
});

describe("ticketLinkCount", () => {
  const none = { hasProblem: false, hasChange: false, hasParent: false, childTickets: 0, linkedTickets: 0, assets: 0 };

  it("is zero for a ticket without links", () => {
    expect(ticketLinkCount(none)).toBe(0);
  });

  it("adds records, hierarchy neighbours, ticket links and assets", () => {
    expect(
      ticketLinkCount({ hasProblem: true, hasChange: true, hasParent: true, childTickets: 2, linkedTickets: 3, assets: 4 }),
    ).toBe(12);
  });
});
