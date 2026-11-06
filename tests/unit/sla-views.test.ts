import { describe, expect, it } from "vitest";
import { OPEN_TICKET_STATUSES } from "@/lib/constants";
import { SLA_VIEW_META, matchesSlaView, parseSlaView, slaViewCandidateWhere, slaViewHref } from "@/lib/sla-views";

const HOUR = 3_600_000;
const created = new Date("2026-01-05T08:00:00Z");
// A 10 hour resolve window: the at-risk stretch is its last 2 hours (20%).
const due = new Date(created.getTime() + 10 * HOUR);

function ticket(over: Partial<Parameters<typeof matchesSlaView>[1]> = {}) {
  return {
    status: "OPEN",
    createdAt: created,
    resolvedAt: null,
    resolveBreached: false,
    responseDueAt: null,
    resolveDueAt: due,
    dueAt: due,
    pendingSince: null,
    pausedMs: 0,
    ...over,
  };
}

const at = (hoursAfterCreation: number) => new Date(created.getTime() + hoursAfterCreation * HOUR);

describe("SLA breached view", () => {
  it("excludes a ticket whose deadline is exactly now (not yet past)", () => {
    expect(matchesSlaView("breached", ticket(), due)).toBe(false);
  });

  it("includes a ticket one millisecond past its deadline", () => {
    expect(matchesSlaView("breached", ticket(), new Date(due.getTime() + 1))).toBe(true);
  });

  it("excludes a ticket still comfortably on track", () => {
    expect(matchesSlaView("breached", ticket(), at(2))).toBe(false);
  });

  it("ignores tickets without any deadline", () => {
    expect(matchesSlaView("breached", ticket({ resolveDueAt: null, dueAt: null }), at(50))).toBe(false);
  });

  it("ignores paused tickets: their clock is stopped", () => {
    expect(matchesSlaView("breached", ticket({ status: "PENDING", pendingSince: at(3) }), at(50))).toBe(false);
    expect(matchesSlaView("breached", ticket({ status: "ON_HOLD" }), at(50))).toBe(false);
  });

  it.each(["RESOLVED", "CLOSED", "CANCELLED"])("ignores a %s ticket even when it missed its deadline", (status) => {
    expect(matchesSlaView("breached", ticket({ status, resolveBreached: true, resolvedAt: at(12) }), at(50))).toBe(false);
  });
});

describe("SLA at risk view", () => {
  it("excludes a ticket just before the last 20% of its window", () => {
    expect(matchesSlaView("at_risk", ticket(), new Date(at(8).getTime() - 1))).toBe(false);
  });

  it("includes a ticket exactly at the start of the last 20%", () => {
    expect(matchesSlaView("at_risk", ticket(), at(8))).toBe(true);
  });

  it("still includes a ticket whose deadline is exactly now", () => {
    expect(matchesSlaView("at_risk", ticket(), due)).toBe(true);
  });

  it("drops a ticket once it is past its deadline (it is breached instead)", () => {
    expect(matchesSlaView("at_risk", ticket(), new Date(due.getTime() + 1))).toBe(false);
  });

  it("measures the window without time the ticket already spent paused", () => {
    // 5h paused: 5h of active budget, so the last 20% starts 1h before the deadline (at 9h), not at 8h.
    const paused = ticket({ pausedMs: 5 * HOUR });
    expect(matchesSlaView("at_risk", paused, at(8.5))).toBe(false);
    expect(matchesSlaView("at_risk", paused, at(9))).toBe(true);
  });

  it("ignores paused and finished tickets", () => {
    expect(matchesSlaView("at_risk", ticket({ status: "PENDING", pendingSince: at(8) }), at(9))).toBe(false);
    expect(matchesSlaView("at_risk", ticket({ status: "RESOLVED", resolvedAt: at(9) }), at(9))).toBe(false);
  });
});

describe("SLA view params", () => {
  it("accepts only the known SLA filters", () => {
    for (const view of ["breached", "at_risk", "on_track", "paused", "none"]) expect(parseSlaView(view)).toBe(view);
    expect(parseSlaView("met")).toBeUndefined();
    expect(parseSlaView(undefined)).toBeUndefined();
    expect(parseSlaView(null)).toBeUndefined();
  });

  it("deep-links the ticket list to a view", () => {
    expect(slaViewHref("breached")).toBe("/tickets?sla=breached");
    expect(slaViewHref("at_risk")).toBe("/tickets?sla=at_risk");
  });
});

describe("SLA view candidate prefilter", () => {
  const now = new Date("2026-01-06T12:00:00Z");
  const deadline = (filter: object) => ({ OR: [{ resolveDueAt: filter }, { resolveDueAt: null, dueAt: filter }] });
  const business = { sla: { businessCalendarId: { not: null } } };
  const wallClock = { OR: [{ slaId: null }, { sla: { businessCalendarId: null } }] };
  const running = { pendingSince: null, status: { notIn: ["PENDING", "ON_HOLD"] } };
  const open = { status: { in: [...OPEN_TICKET_STATUSES] }, resolvedAt: null };
  const candidates = (window: object) => ({
    ...open,
    AND: [deadline({ not: null }), running, { OR: [business, { AND: [wallClock, window] }] }],
  });

  it("keeps only wall-clock tickets whose deadline has passed for the breached view", () => {
    expect(slaViewCandidateWhere("breached", now)).toEqual(candidates(deadline({ lt: now })));
  });

  it("keeps every wall-clock ticket not yet past its deadline for the at-risk view, however far ahead the deadline is", () => {
    expect(slaViewCandidateWhere("at_risk", now)).toEqual(candidates(deadline({ gte: now })));
  });

  it("keeps wall-clock tickets that are not yet past their deadline for the on-track view", () => {
    expect(slaViewCandidateWhere("on_track", now)).toEqual(candidates(deadline({ gte: now })));
  });

  it("keeps the tickets whose clock is stopped for the paused view", () => {
    expect(slaViewCandidateWhere("paused", now)).toEqual({
      ...open,
      AND: [deadline({ not: null }), { OR: [{ pendingSince: { not: null } }, { status: { in: ["PENDING", "ON_HOLD"] } }] }],
    });
  });

  it("never filters out tickets on a business calendar: their clock counts working time", () => {
    for (const view of ["breached", "at_risk", "on_track"] as const) {
      expect(JSON.stringify(slaViewCandidateWhere(view, now))).toContain(JSON.stringify(business));
    }
  });
});

describe("SLA on track, paused and no SLA views", () => {
  it("puts a running ticket with time left on track", () => {
    expect(matchesSlaView("on_track", ticket(), at(2))).toBe(true);
    expect(matchesSlaView("on_track", ticket(), at(8))).toBe(false);
    expect(matchesSlaView("on_track", ticket(), new Date(due.getTime() + 1))).toBe(false);
  });

  it("puts waiting tickets under paused, and nowhere else", () => {
    const waiting = ticket({ status: "PENDING", pendingSince: at(3) });
    expect(matchesSlaView("paused", waiting, at(50))).toBe(true);
    expect(matchesSlaView("on_track", waiting, at(50))).toBe(false);
    expect(matchesSlaView("paused", ticket(), at(2))).toBe(false);
  });

  it("gives tickets without a deadline and finished tickets no SLA", () => {
    expect(matchesSlaView("none", ticket({ resolveDueAt: null, dueAt: null }), at(2))).toBe(true);
    expect(matchesSlaView("none", ticket({ status: "RESOLVED", resolvedAt: at(3) }), at(5))).toBe(true);
    expect(matchesSlaView("none", ticket(), at(2))).toBe(false);
  });

  it("keeps a finished ticket out of every other view", () => {
    for (const view of ["breached", "at_risk", "on_track", "paused"] as const) {
      expect(matchesSlaView(view, ticket({ status: "CLOSED", resolvedAt: at(3), resolveBreached: true }), at(50))).toBe(false);
    }
  });

  it("names the same tickets as the SQL filter for no SLA", async () => {
    const { slaViewWhere } = await import("@/lib/sla-views");
    expect(await slaViewWhere("none")).toEqual({
      OR: [{ status: { in: ["RESOLVED", "CLOSED", "CANCELLED"] } }, { resolvedAt: { not: null } }, { resolveDueAt: null, dueAt: null }],
    });
  });
});

describe("SLA view labels", () => {
  it("calls the no-clock view \"No active SLA\" because it also covers finished tickets", () => {
    expect(SLA_VIEW_META.none.label).toBe("No active SLA");
  });
});
