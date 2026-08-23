import { describe, expect, it } from "vitest";
import type { BusinessCalendarLike } from "@/lib/business-hours";
import {
  deadlineFrom,
  firstResponseBreached,
  firstResponseData,
  pauseData,
  resolveBreachData,
  resumeData,
  slaElapsedPercent,
  slaSnapshot,
  statusChangeData,
} from "@/lib/sla";

const nine17 = [["09:00", "17:00"]];
const CAL: BusinessCalendarLike = {
  timezone: "UTC",
  weeklyHours: JSON.stringify({ sun: [], mon: nine17, tue: nine17, wed: nine17, thu: nine17, fri: nine17, sat: [] }),
};

// 2024-01-08 (Mon) 12:00 UTC — inside the open window.
const T0 = new Date(Date.UTC(2024, 0, 8, 12));
const at = (ms: number) => new Date(T0.getTime() + ms);
const HOUR = 3_600_000;

type Clock = {
  responseDueAt: Date | null;
  resolveDueAt: Date | null;
  dueAt: Date | null;
  pendingSince: Date | null;
  pausedMs: number;
};

const clock = (over: Partial<Clock> = {}): Clock => ({
  responseDueAt: at(2 * HOUR),
  resolveDueAt: at(8 * HOUR),
  dueAt: at(8 * HOUR),
  pendingSince: null,
  pausedMs: 0,
  ...over,
});

describe("deadlineFrom", () => {
  it("adds wall-clock minutes without a calendar", () => {
    expect(deadlineFrom(T0, 60, null)?.toISOString()).toBe(at(HOUR).toISOString());
  });

  it("counts business minutes with a calendar", () => {
    // 2 business hours from Mon 16:00 → Tue 10:00.
    const from = new Date(Date.UTC(2024, 0, 8, 16));
    expect(deadlineFrom(from, 120, CAL)?.toISOString()).toBe(new Date(Date.UTC(2024, 0, 9, 10)).toISOString());
  });

  it("returns null for a degenerate (never-open) calendar", () => {
    const closed: BusinessCalendarLike = { timezone: "UTC", weeklyHours: "{}" };
    expect(deadlineFrom(T0, 60, closed)).toBeNull();
  });
});

describe("pauseData / resumeData", () => {
  it("anchors the pause once and never resets the anchor", () => {
    expect(pauseData({ pendingSince: null }, T0)).toEqual({ pendingSince: T0 });
    expect(pauseData({ pendingSince: at(HOUR) }, at(2 * HOUR))).toEqual({});
  });

  it("wall-clock resume shifts deadlines by the raw pause delta", () => {
    const out = resumeData(clock({ pendingSince: at(HOUR) }), at(3 * HOUR));
    expect(out.pendingSince).toBeNull();
    expect(out.pausedMs).toBe(2 * HOUR);
    expect((out.resolveDueAt as Date).getTime()).toBe(at(10 * HOUR).getTime());
  });

  it("business resume shifts by BUSINESS time consumed during the pause", () => {
    // Pause Mon 16:00 → Tue 11:00 (wall 19h): business time consumed is only
    // Mon 16–17 (1h) + Tue 09–11 (2h) = 3h. The deadline (set for Tue 16:00)
    // moves forward by 3 BUSINESS hours → Wed 11:00 — not by 19 wall hours.
    const t = clock({
      pendingSince: new Date(Date.UTC(2024, 0, 8, 16)),
      resolveDueAt: new Date(Date.UTC(2024, 0, 9, 16)),
      dueAt: new Date(Date.UTC(2024, 0, 9, 16)),
    });
    const out = resumeData(t, new Date(Date.UTC(2024, 0, 9, 11)), CAL);
    expect(out.pausedMs).toBe(3 * HOUR);
    expect((out.resolveDueAt as Date).toISOString()).toBe(new Date(Date.UTC(2024, 0, 10, 11)).toISOString());
  });

  it("a weekend pause consumes zero business time", () => {
    const t = clock({
      pendingSince: new Date(Date.UTC(2024, 0, 6, 12)), // Saturday
      resolveDueAt: new Date(Date.UTC(2024, 0, 9, 16)), // Tuesday
      dueAt: new Date(Date.UTC(2024, 0, 9, 16)),
    });
    const out = resumeData(t, new Date(Date.UTC(2024, 0, 7, 12)), CAL); // Sunday
    expect(out.pausedMs).toBe(0);
    expect((out.resolveDueAt as Date).toISOString()).toBe(new Date(Date.UTC(2024, 0, 9, 16)).toISOString());
  });

  it("no-op when the ticket wasn't paused", () => {
    expect(resumeData(clock())).toEqual({});
  });
});

describe("statusChangeData", () => {
  it("entering PENDING anchors the pause", () => {
    const out = statusChangeData({ ...clock(), status: "OPEN" }, "PENDING", T0);
    expect(out.pendingSince).toEqual(T0);
  });

  it("leaving PENDING resumes the clock and clears the reason", () => {
    const out = statusChangeData({ ...clock({ pendingSince: at(HOUR) }), status: "PENDING" }, "OPEN", at(2 * HOUR));
    expect(out.pendingSince).toBeNull();
    expect(out.pausedMs).toBe(HOUR);
    expect(out.pendingReason).toBeNull();
    expect(out.pendingNote).toBeNull();
  });

  it("RESOLVED from a pause judges breach against the SHIFTED deadline", () => {
    // Due Mon 20:00 (8h). Paused 13:00 → 22:00 (9h wall) shifts the deadline
    // to Tue 05:00, so resolving at Mon 22:00 is NOT a breach — the pause
    // genuinely bought the ticket time.
    const out = statusChangeData({ ...clock({ pendingSince: at(HOUR) }), status: "PENDING" }, "RESOLVED", at(10 * HOUR)) as Record<string, unknown>;
    expect(out.resolvedAt).toEqual(at(10 * HOUR));
    expect(out.resolveBreached).toBe(false);
  });

  it("RESOLVED without a pause judges the original deadline", () => {
    const out = statusChangeData({ ...clock(), status: "OPEN" }, "RESOLVED", at(9 * HOUR)) as Record<string, unknown>;
    expect(out.resolveBreached).toBe(true);
  });

  it("CLOSED stamps closedAt", () => {
    const out = statusChangeData({ ...clock(), status: "RESOLVED" }, "CLOSED", T0) as Record<string, unknown>;
    expect(out.closedAt).toEqual(T0);
  });

  it("reopening clears resolution fields", () => {
    const out = statusChangeData({ ...clock(), status: "RESOLVED" }, "OPEN", T0) as Record<string, unknown>;
    expect(out.resolvedAt).toBeNull();
    expect(out.closedAt).toBeNull();
    expect(out.resolutionCode).toBeNull();
    expect(out.resolveBreached).toBe(false);
  });
});

describe("slaSnapshot", () => {
  const meta = { status: "OPEN", resolvedAt: null as Date | null, createdAt: T0, resolveBreached: false };

  it("NONE without a deadline", () => {
    expect(slaSnapshot({ ...clock({ resolveDueAt: null, dueAt: null }), ...meta })).toEqual({ state: "NONE", dueAt: null });
  });

  it("PAUSED while pending", () => {
    const t = { ...clock({ pendingSince: at(HOUR) }), ...meta, status: "PENDING" };
    expect(slaSnapshot(t, at(2 * HOUR)).state).toBe("PAUSED");
  });

  it("BREACHED past the deadline", () => {
    expect(slaSnapshot({ ...clock(), ...meta }, at(9 * HOUR)).state).toBe("BREACHED");
  });

  it("AT_RISK inside the last 20% of the window", () => {
    // 8h window → at-risk under 1.6h remaining.
    expect(slaSnapshot({ ...clock(), ...meta }, at(7 * HOUR)).state).toBe("AT_RISK");
    expect(slaSnapshot({ ...clock(), ...meta }, at(5 * HOUR)).state).toBe("ON_TRACK");
  });

  it("MET / BREACHED once resolved, per the recorded breach flag", () => {
    expect(slaSnapshot({ ...clock(), ...meta, resolvedAt: at(HOUR), status: "RESOLVED" }).state).toBe("MET");
    expect(slaSnapshot({ ...clock(), ...meta, resolvedAt: at(9 * HOUR), status: "RESOLVED", resolveBreached: true }).state).toBe("BREACHED");
  });

  it("business mode: a pause+resume does not double-count pause time (regression)", () => {
    // Ticket created Mon 12:00, resolve deadline Tue 12:00 (4h + 4h business).
    // Paused Mon 16:00 → Tue 10:00 (3 business hours). Resume shifts the
    // deadline by 3 business hours to Wed 11:00 and banks pausedMs=3h.
    const t = {
      ...clock({
        pendingSince: null,
        pausedMs: 3 * HOUR,
        resolveDueAt: new Date(Date.UTC(2024, 0, 10, 11)),
        dueAt: new Date(Date.UTC(2024, 0, 10, 11)),
      }),
      ...meta,
    };
    // At Tue 11:00 the ticket has consumed 5 business hours of an 8-hour
    // budget → ON_TRACK (the old budget-minus-pausedMs formula claimed 8h of
    // an effectively 5h budget → premature BREACHED).
    expect(slaSnapshot(t, new Date(Date.UTC(2024, 0, 9, 11)), CAL).state).toBe("ON_TRACK");
  });

  it("wall-clock mode still excludes banked pause time from the budget", () => {
    const t = { ...clock({ pausedMs: 2 * HOUR }), ...meta };
    // Deadline 8h out, 2h banked → effective budget 6h → at-risk threshold
    // remaining ≤ 1.2h. Remaining is dueAt − now, so: 4h left = ON_TRACK,
    // 1h left = AT_RISK, past the deadline = BREACHED.
    expect(slaSnapshot(t, at(4 * HOUR)).state).toBe("ON_TRACK");
    expect(slaSnapshot(t, at(7 * HOUR)).state).toBe("AT_RISK");
    expect(slaSnapshot(t, at(9 * HOUR)).state).toBe("BREACHED");
  });
});

describe("slaElapsedPercent", () => {
  const meta = { createdAt: T0, status: "OPEN", resolvedAt: null, resolveBreached: false };
  it("tracks progress and can exceed 100", () => {
    expect(slaElapsedPercent({ ...clock(), ...meta }, at(4 * HOUR))).toBe(50);
    expect(slaElapsedPercent({ ...clock(), ...meta }, at(10 * HOUR))).toBe(125);
  });
  it("null without a deadline", () => {
    expect(slaElapsedPercent({ ...clock({ resolveDueAt: null, dueAt: null }), ...meta })).toBeNull();
  });
  it("business mode counts working time only", () => {
    const t = { ...clock({ resolveDueAt: new Date(Date.UTC(2024, 0, 9, 11)), dueAt: new Date(Date.UTC(2024, 0, 9, 11)) }), ...meta };
    // Budget Mon 12:00 → Tue 11:00 = 5h (Mon PM) + 2h (Tue AM) = 7 business
    // hours; at Tue 10:00 the ticket has consumed 5h + 1h = 6 of them.
    expect(slaElapsedPercent(t, new Date(Date.UTC(2024, 0, 9, 10)), CAL)).toBeCloseTo((6 / 7) * 100, 5);
  });
});

describe("first-response helpers", () => {
  it("stamps the first response and judges the deadline", () => {
    expect(firstResponseData({ responseDueAt: at(HOUR) }, at(HOUR / 2))).toEqual({
      firstResponseAt: at(HOUR / 2),
      responseBreached: false,
    });
    expect(firstResponseData({ responseDueAt: at(HOUR) }, at(2 * HOUR)).responseBreached).toBe(true);
  });

  it("breach detection respects pauses and recorded responses", () => {
    const base = { responseDueAt: at(HOUR), firstResponseAt: null, pendingSince: null };
    expect(firstResponseBreached({ ...base, status: "OPEN" }, at(2 * HOUR))).toBe(true);
    expect(firstResponseBreached({ ...base, status: "OPEN" }, at(HOUR / 2))).toBe(false);
    expect(firstResponseBreached({ ...base, status: "PENDING" }, at(2 * HOUR))).toBe(false);
    expect(firstResponseBreached({ ...base, firstResponseAt: at(HOUR / 2), status: "OPEN" }, at(2 * HOUR))).toBe(false);
  });
});

describe("resolveBreachData", () => {
  it("judges the resolve deadline at resolution time", () => {
    expect(resolveBreachData({ resolveDueAt: at(HOUR) }, at(HOUR / 2)).resolveBreached).toBe(false);
    expect(resolveBreachData({ resolveDueAt: at(HOUR) }, at(2 * HOUR)).resolveBreached).toBe(true);
    expect(resolveBreachData({ resolveDueAt: null }, at(HOUR)).resolveBreached).toBe(false);
  });
});
