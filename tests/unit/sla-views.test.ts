import { describe, expect, it } from "vitest";
import { matchesSlaView, parseSlaView, slaViewHref } from "@/lib/sla-views";

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
  it("accepts only the two built-in views", () => {
    expect(parseSlaView("breached")).toBe("breached");
    expect(parseSlaView("at_risk")).toBe("at_risk");
    expect(parseSlaView("met")).toBeUndefined();
    expect(parseSlaView(undefined)).toBeUndefined();
    expect(parseSlaView(null)).toBeUndefined();
  });

  it("deep-links the ticket list to a view", () => {
    expect(slaViewHref("breached")).toBe("/tickets?sla=breached");
    expect(slaViewHref("at_risk")).toBe("/tickets?sla=at_risk");
  });
});
