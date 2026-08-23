import { describe, expect, it } from "vitest";
import {
  addBusinessMs,
  defaultWeeklyHoursJson,
  elapsedBusinessMs,
  isAlwaysOpen,
  type BusinessCalendarLike,
} from "@/lib/business-hours";

// Mon–Fri 09:00–17:00 UTC. Deterministic: no DST in UTC.
const nine17 = [["09:00", "17:00"]];
const MON_FRI_9_17: BusinessCalendarLike = {
  timezone: "UTC",
  weeklyHours: JSON.stringify({ sun: [], mon: nine17, tue: nine17, wed: nine17, thu: nine17, fri: nine17, sat: [] }),
};

// 2024-01-08 is a Monday.
const mon = (h: number, m = 0) => new Date(Date.UTC(2024, 0, 8, h, m));
const tue = (h: number, m = 0) => new Date(Date.UTC(2024, 0, 9, h, m));
const fri = (h: number, m = 0) => new Date(Date.UTC(2024, 0, 12, h, m));
const sat = (h: number, m = 0) => new Date(Date.UTC(2024, 0, 13, h, m));

describe("elapsedBusinessMs", () => {
  it("counts only time inside the open window", () => {
    // 10:00 → 12:00 on Monday = 2h inside 09–17.
    expect(elapsedBusinessMs(mon(10), mon(12), MON_FRI_9_17)).toBe(2 * 3_600_000);
  });

  it("clamps spans that start before the window opens", () => {
    // 07:00 → 10:00 → only 09:00–10:00 counts (1h).
    expect(elapsedBusinessMs(mon(7), mon(10), MON_FRI_9_17)).toBe(3_600_000);
  });

  it("skips the closed weekend entirely", () => {
    // Friday Jan 12 16:00 → Monday Jan 15 10:00: 1h Friday + 1h Monday.
    expect(elapsedBusinessMs(fri(16), new Date(Date.UTC(2024, 0, 15, 10)), MON_FRI_9_17)).toBe(2 * 3_600_000);
  });

  it("returns 0 for a span fully outside open hours", () => {
    expect(elapsedBusinessMs(sat(0), sat(23), MON_FRI_9_17)).toBe(0);
  });

  it("returns 0 when end <= start", () => {
    expect(elapsedBusinessMs(mon(12), mon(10), MON_FRI_9_17)).toBe(0);
    expect(elapsedBusinessMs(mon(12), mon(12), MON_FRI_9_17)).toBe(0);
  });

  it("honours holidays as fully closed days", () => {
    const cal: BusinessCalendarLike = {
      ...MON_FRI_9_17,
      holidays: [{ date: new Date(Date.UTC(2024, 0, 9)) }], // Tuesday holiday
    };
    // Monday 16:00 → Tuesday 18:00: only Monday 16–17 counts (Tuesday closed).
    expect(elapsedBusinessMs(mon(16), tue(18), cal)).toBe(3_600_000);
  });

  it("supports multiple windows per day without double-counting overlaps", () => {
    const cal: BusinessCalendarLike = {
      timezone: "UTC",
      weeklyHours: JSON.stringify({
        mon: [["09:00", "12:00"], ["11:00", "13:00"], ["14:00", "17:00"]], // overlap 11–12 merges
        tue: nine17, wed: nine17, thu: nine17, fri: nine17, sun: [], sat: [],
      }),
    };
    // 09:00 → 14:00: windows 09–13 (merged) = 4h; 14:00 window not yet elapsed.
    expect(elapsedBusinessMs(mon(9), mon(14), cal)).toBe(4 * 3_600_000);
  });
});

describe("addBusinessMs", () => {
  it("lands inside the same day when the budget fits", () => {
    expect(addBusinessMs(mon(10), 2 * 3_600_000, MON_FRI_9_17).toISOString()).toBe(mon(12).toISOString());
  });

  it("rolls over the closed evening into the next morning", () => {
    // 2 business hours from Monday 16:00 → Tuesday 10:00.
    expect(addBusinessMs(mon(16), 2 * 3_600_000, MON_FRI_9_17).toISOString()).toBe(tue(10).toISOString());
  });

  it("skips the weekend", () => {
    // 1 business hour from Friday 16:30 → Monday 09:30.
    const out = addBusinessMs(fri(16, 30), 3_600_000, MON_FRI_9_17);
    expect(out.toISOString()).toBe(new Date(Date.UTC(2024, 0, 15, 9, 30)).toISOString()); // next Monday
  });

  it("consumes only the post-start part of the first window", () => {
    // Starting at 15:00, 3 business hours remain in the day (15–17 is 2h)…
    // 3h needs 2h Monday + 1h Tuesday 09:00.
    expect(addBusinessMs(mon(15), 3 * 3_600_000, MON_FRI_9_17).toISOString()).toBe(tue(10).toISOString());
  });

  it("returns start unchanged for a calendar with no open time (degenerate)", () => {
    const closed: BusinessCalendarLike = { timezone: "UTC", weeklyHours: "{}" };
    const start = mon(10);
    expect(addBusinessMs(start, 3_600_000, closed).getTime()).toBe(start.getTime());
  });

  it("returns a copy for non-positive durations", () => {
    const start = mon(10);
    const zero = addBusinessMs(start, 0, MON_FRI_9_17);
    expect(zero.getTime()).toBe(start.getTime());
    expect(zero).not.toBe(start);
  });
});

describe("isAlwaysOpen", () => {
  const all = [["00:00", "24:00"]];
  it("recognises a 24/7 schedule", () => {
    const cal: BusinessCalendarLike = {
      timezone: "UTC",
      weeklyHours: JSON.stringify({ sun: all, mon: all, tue: all, wed: all, thu: all, fri: all, sat: all }),
    };
    expect(isAlwaysOpen(cal)).toBe(true);
  });

  it("rejects a business-hours schedule", () => {
    expect(isAlwaysOpen(MON_FRI_9_17)).toBe(false);
  });

  it("rejects 24/7 with holidays", () => {
    const cal: BusinessCalendarLike = {
      timezone: "UTC",
      weeklyHours: JSON.stringify({ sun: all, mon: all, tue: all, wed: all, thu: all, fri: all, sat: all }),
      holidays: [{ date: new Date(Date.UTC(2024, 11, 25)) }],
    };
    expect(isAlwaysOpen(cal)).toBe(false);
  });
});

describe("defaultWeeklyHoursJson", () => {
  it("round-trips into a Mon–Fri 9–5 schedule", () => {
    const cal: BusinessCalendarLike = { timezone: "UTC", weeklyHours: defaultWeeklyHoursJson() };
    expect(isAlwaysOpen(cal)).toBe(false);
    expect(elapsedBusinessMs(mon(9), mon(17), cal)).toBe(8 * 3_600_000);
    expect(elapsedBusinessMs(sat(0), sat(23), cal)).toBe(0);
  });
});
