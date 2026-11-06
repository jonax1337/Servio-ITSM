import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  calendarDateIn,
  canCreateOverride,
  canRemoveOverride,
  findGaps,
  isOnCallEscalationAction,
  isValidHandoffTime,
  isValidTimeZone,
  onCallAt,
  parseCalendarDate,
  parseZonedDateTime,
  overrideWindowError,
  pickOnCallAssignee,
  rotationHolderAt,
  shiftHours,
  zonedWallToUtc,
  type OverrideWindow,
  type ScheduleInput,
} from "@/lib/oncall-rules";

const d = (iso: string) => new Date(iso);

const weekly: ScheduleInput = {
  rotationType: "WEEKLY",
  customIntervalHours: null,
  handoffTime: "09:00",
  timezone: "UTC",
  rotationStart: d("2026-01-05T09:00:00Z"), // a Monday
  memberIds: ["ann", "bob", "cy"],
  overrides: [],
};

const override = (over: Partial<OverrideWindow> & Pick<OverrideWindow, "startsAt" | "endsAt">): OverrideWindow => ({
  id: "o1",
  userId: "dan",
  replacesUserId: null,
  ...over,
});

describe("shiftHours", () => {
  it("uses the fixed length of daily and weekly rotations", () => {
    expect(shiftHours({ rotationType: "DAILY", customIntervalHours: null })).toBe(24);
    expect(shiftHours({ rotationType: "WEEKLY", customIntervalHours: 5 })).toBe(168);
  });

  it("uses the custom interval and rejects missing or non-positive ones", () => {
    expect(shiftHours({ rotationType: "CUSTOM", customIntervalHours: 12 })).toBe(12);
    expect(shiftHours({ rotationType: "CUSTOM", customIntervalHours: null })).toBeNull();
    expect(shiftHours({ rotationType: "CUSTOM", customIntervalHours: 0 })).toBeNull();
    expect(shiftHours({ rotationType: "BOGUS", customIntervalHours: 12 })).toBeNull();
  });
});

describe("rotation math", () => {
  it("starts with the first member exactly at rotationStart", () => {
    expect(rotationHolderAt(weekly, d("2026-01-05T09:00:00Z"))).toBe("ann");
  });

  it("hands off at the end of each shift and wraps around", () => {
    expect(rotationHolderAt(weekly, d("2026-01-12T08:59:59Z"))).toBe("ann");
    expect(rotationHolderAt(weekly, d("2026-01-12T09:00:00Z"))).toBe("bob");
    expect(rotationHolderAt(weekly, d("2026-01-19T09:00:00Z"))).toBe("cy");
    expect(rotationHolderAt(weekly, d("2026-01-26T09:00:00Z"))).toBe("ann");
  });

  it("rotates daily", () => {
    const daily = { ...weekly, rotationType: "DAILY" };
    expect(rotationHolderAt(daily, d("2026-01-06T10:00:00Z"))).toBe("bob");
    expect(rotationHolderAt(daily, d("2026-01-08T10:00:00Z"))).toBe("ann");
  });

  it("rotates on a custom interval from rotationStart", () => {
    const custom = { ...weekly, rotationType: "CUSTOM", customIntervalHours: 12 };
    expect(rotationHolderAt(custom, d("2026-01-05T20:59:00Z"))).toBe("ann");
    expect(rotationHolderAt(custom, d("2026-01-05T21:00:00Z"))).toBe("bob");
    expect(rotationHolderAt(custom, d("2026-01-06T09:00:00Z"))).toBe("cy");
  });

  it("is a gap before the rotation starts", () => {
    expect(rotationHolderAt(weekly, d("2026-01-05T08:59:59Z"))).toBeNull();
  });

  it("is a gap without members or without a usable interval", () => {
    expect(rotationHolderAt({ ...weekly, memberIds: [] }, d("2026-02-01T00:00:00Z"))).toBeNull();
    const broken = { ...weekly, rotationType: "CUSTOM", customIntervalHours: null };
    expect(rotationHolderAt(broken, d("2026-02-01T00:00:00Z"))).toBeNull();
  });

  it("keeps a single member on call permanently", () => {
    expect(rotationHolderAt({ ...weekly, memberIds: ["ann"] }, d("2027-06-01T00:00:00Z"))).toBe("ann");
  });

  it("hands off at the same local time across a DST change", () => {
    // Europe/Berlin: CET (+1) until 2026-03-29 01:00 UTC, then CEST (+2). 09:00 local handoff.
    const berlin: ScheduleInput = {
      ...weekly,
      rotationType: "DAILY",
      timezone: "Europe/Berlin",
      rotationStart: d("2026-03-27T08:00:00Z"), // 09:00 CET
    };
    expect(rotationHolderAt(berlin, d("2026-03-28T07:59:00Z"))).toBe("ann"); // before 09:00 CET
    expect(rotationHolderAt(berlin, d("2026-03-28T08:00:00Z"))).toBe("bob");
    // After the change the handoff moves to 07:00 UTC (09:00 CEST).
    expect(rotationHolderAt(berlin, d("2026-03-29T06:59:00Z"))).toBe("bob");
    expect(rotationHolderAt(berlin, d("2026-03-29T07:00:00Z"))).toBe("cy");
  });
});

describe("calendarDateIn", () => {
  it("names the day it already is in the zone, not in UTC", () => {
    const lateEveningUtc = d("2026-03-10T23:30:00Z");
    expect(calendarDateIn(lateEveningUtc, "UTC")).toBe("2026-03-10");
    expect(calendarDateIn(lateEveningUtc, "Asia/Tokyo")).toBe("2026-03-11");
    expect(calendarDateIn(lateEveningUtc, "America/Los_Angeles")).toBe("2026-03-10");
  });

  it("pads single-digit months and days", () => {
    expect(calendarDateIn(d("2026-01-05T12:00:00Z"), "UTC")).toBe("2026-01-05");
  });
});

describe("zonedWallToUtc", () => {
  it("converts wall time using the zone's offset at that date", () => {
    expect(zonedWallToUtc({ year: 2026, month: 1, day: 15 }, "09:00", "Europe/Berlin").toISOString()).toBe(
      "2026-01-15T08:00:00.000Z",
    );
    expect(zonedWallToUtc({ year: 2026, month: 7, day: 15 }, "09:00", "Europe/Berlin").toISOString()).toBe(
      "2026-07-15T07:00:00.000Z",
    );
    expect(zonedWallToUtc({ year: 2026, month: 1, day: 15 }, "09:00", "America/New_York").toISOString()).toBe(
      "2026-01-15T14:00:00.000Z",
    );
  });

  it("treats an unknown zone as UTC", () => {
    expect(zonedWallToUtc({ year: 2026, month: 1, day: 15 }, "09:00", "Mars/Olympus").toISOString()).toBe(
      "2026-01-15T09:00:00.000Z",
    );
  });
});

describe("validators", () => {
  it("validates IANA zones and HH:mm handoff times", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidHandoffTime("09:00")).toBe(true);
    expect(isValidHandoffTime("24:00")).toBe(false);
    expect(isValidHandoffTime("9:00")).toBe(false);
  });
});

describe("overrides", () => {
  const swap = override({ startsAt: d("2026-01-07T00:00:00Z"), endsAt: d("2026-01-08T00:00:00Z"), replacesUserId: "ann" });
  const schedule = { ...weekly, overrides: [swap] };

  it("wins over the rotation inside its window", () => {
    expect(onCallAt(schedule, d("2026-01-07T12:00:00Z"))).toEqual({ userId: "dan", source: "OVERRIDE", overrideId: "o1" });
  });

  it("is half-open: active at startsAt, inactive at endsAt", () => {
    expect(onCallAt(schedule, d("2026-01-07T00:00:00Z"))?.userId).toBe("dan");
    expect(onCallAt(schedule, d("2026-01-08T00:00:00Z"))).toEqual({ userId: "ann", source: "ROTATION", overrideId: null });
  });

  it("falls back to the rotation outside any override", () => {
    expect(onCallAt(schedule, d("2026-01-06T00:00:00Z"))?.userId).toBe("ann");
  });

  it("covers a gap: an override works with no members at all", () => {
    const empty = { ...schedule, memberIds: [] };
    expect(onCallAt(empty, d("2026-01-06T00:00:00Z"))).toBeNull();
    expect(onCallAt(empty, d("2026-01-07T12:00:00Z"))?.userId).toBe("dan");
  });

  it("prefers the override that starts latest when two overlap", () => {
    const later = override({ id: "o2", userId: "eve", startsAt: d("2026-01-07T06:00:00Z"), endsAt: d("2026-01-07T18:00:00Z") });
    const overlapping = { ...weekly, overrides: [swap, later] };
    expect(onCallAt(overlapping, d("2026-01-07T05:00:00Z"))?.userId).toBe("dan");
    expect(onCallAt(overlapping, d("2026-01-07T12:00:00Z"))?.userId).toBe("eve");
  });
});

describe("buildTimeline", () => {
  const from = d("2026-01-05T00:00:00Z");
  const to = d("2026-01-19T00:00:00Z");

  it("starts with a gap until the rotation begins, then follows the rotation", () => {
    const timeline = buildTimeline(weekly, from, to);
    expect(timeline.map((s) => [s.userId, s.start.toISOString(), s.end.toISOString()])).toEqual([
      [null, "2026-01-05T00:00:00.000Z", "2026-01-05T09:00:00.000Z"],
      ["ann", "2026-01-05T09:00:00.000Z", "2026-01-12T09:00:00.000Z"],
      ["bob", "2026-01-12T09:00:00.000Z", "2026-01-19T00:00:00.000Z"],
    ]);
  });

  it("splits the rotation around an override", () => {
    const swap = override({ startsAt: d("2026-01-07T00:00:00Z"), endsAt: d("2026-01-08T00:00:00Z") });
    const timeline = buildTimeline({ ...weekly, overrides: [swap] }, d("2026-01-06T00:00:00Z"), d("2026-01-12T00:00:00Z"));
    expect(timeline.map((s) => [s.userId, s.source])).toEqual([
      ["ann", "ROTATION"],
      ["dan", "OVERRIDE"],
      ["ann", "ROTATION"],
    ]);
  });

  it("merges consecutive stretches of the same holder", () => {
    const solo = { ...weekly, rotationType: "DAILY", memberIds: ["ann"] };
    const timeline = buildTimeline(solo, d("2026-01-06T00:00:00Z"), d("2026-01-10T00:00:00Z"));
    expect(timeline).toHaveLength(1);
    expect(timeline[0].userId).toBe("ann");
  });

  it("returns nothing for an empty or inverted range", () => {
    expect(buildTimeline(weekly, to, from)).toEqual([]);
  });

  it("finds gaps, including an override-free stretch with no members", () => {
    const empty = { ...weekly, memberIds: [] };
    const swap = override({ startsAt: d("2026-01-07T00:00:00Z"), endsAt: d("2026-01-08T00:00:00Z") });
    const gaps = findGaps(buildTimeline({ ...empty, overrides: [swap] }, d("2026-01-06T00:00:00Z"), d("2026-01-10T00:00:00Z")));
    expect(gaps.map((g) => [g.start.toISOString(), g.end.toISOString()])).toEqual([
      ["2026-01-06T00:00:00.000Z", "2026-01-07T00:00:00.000Z"],
      ["2026-01-08T00:00:00.000Z", "2026-01-10T00:00:00.000Z"],
    ]);
  });

  it("agrees with onCallAt at every segment start", () => {
    const swap = override({ startsAt: d("2026-01-14T00:00:00Z"), endsAt: d("2026-01-16T12:00:00Z") });
    const schedule = { ...weekly, overrides: [swap] };
    for (const segment of buildTimeline(schedule, from, to)) {
      expect(onCallAt(schedule, segment.start)?.userId ?? null).toBe(segment.userId);
    }
  });
});

describe("pickOnCallAssignee", () => {
  it("returns null when nobody is on call", () => {
    expect(pickOnCallAssignee([], "ann")).toBeNull();
  });

  it("keeps the current assignee when they are on call", () => {
    expect(pickOnCallAssignee(["bob", "ann"], "ann")).toBe("ann");
  });

  it("otherwise picks the first on-call user", () => {
    expect(pickOnCallAssignee(["bob", "ann"], "cy")).toBe("bob");
    expect(pickOnCallAssignee(["bob"], null)).toBe("bob");
  });
});

describe("overrideWindowError", () => {
  const now = d("2026-01-10T12:00:00Z");

  it("accepts a normal window", () => {
    expect(overrideWindowError(d("2026-01-11T00:00:00Z"), d("2026-01-12T00:00:00Z"), now)).toBeNull();
  });

  it("rejects inverted, finished, too long and too distant windows", () => {
    expect(overrideWindowError(d("2026-01-12T00:00:00Z"), d("2026-01-11T00:00:00Z"), now)).toMatch(/after the start/);
    expect(overrideWindowError(d("2026-01-08T00:00:00Z"), d("2026-01-09T00:00:00Z"), now)).toMatch(/already over/);
    expect(overrideWindowError(d("2026-01-11T00:00:00Z"), d("2026-06-01T00:00:00Z"), now)).toMatch(/at most 90 days/);
    expect(overrideWindowError(d("2028-01-01T00:00:00Z"), d("2028-01-02T00:00:00Z"), now)).toMatch(/ahead/);
    expect(overrideWindowError(new Date("nope"), d("2026-01-12T00:00:00Z"), now)).toMatch(/valid/);
  });

  it("allows an override that is already running", () => {
    expect(overrideWindowError(d("2026-01-10T00:00:00Z"), d("2026-01-11T00:00:00Z"), now)).toBeNull();
  });
});

describe("override permissions", () => {
  // weekly: ann Jan 5-12, bob Jan 12-19, cy Jan 19-26 (09:00 UTC handoffs)
  const ann = { id: "ann", isManager: false };
  const ownShift = { startsAt: d("2026-01-07T00:00:00Z"), endsAt: d("2026-01-08T00:00:00Z") };
  const handOver = { userId: "dan", replacesUserId: "ann", ...ownShift };

  it("lets managers set any override", () => {
    const any = { userId: "dan", replacesUserId: null, startsAt: d("2026-01-13T00:00:00Z"), endsAt: d("2026-01-14T00:00:00Z") };
    expect(canCreateOverride({ id: "mia", isManager: true }, any, weekly)).toBe(true);
  });

  it("lets a rotation member hand over a window inside their own shift", () => {
    expect(canCreateOverride(ann, handOver, weekly)).toBe(true);
    const wholeShift = { ...handOver, startsAt: d("2026-01-05T09:00:00Z"), endsAt: d("2026-01-12T09:00:00Z") };
    expect(canCreateOverride(ann, wholeShift, weekly)).toBe(true);
  });

  it("refuses a window during another member's shift", () => {
    const bobsShift = { ...handOver, startsAt: d("2026-01-13T00:00:00Z"), endsAt: d("2026-01-14T00:00:00Z") };
    expect(canCreateOverride(ann, bobsShift, weekly)).toBe(false);
  });

  it("refuses a window spanning a handoff, or reaching outside the rotation", () => {
    const spanning = { ...handOver, startsAt: d("2026-01-11T00:00:00Z"), endsAt: d("2026-01-13T00:00:00Z") };
    expect(canCreateOverride(ann, spanning, weekly)).toBe(false);
    const beforeStart = { ...handOver, startsAt: d("2026-01-04T00:00:00Z"), endsAt: d("2026-01-06T00:00:00Z") };
    expect(canCreateOverride(ann, beforeStart, weekly)).toBe(false);
  });

  it("refuses swaps labelled for someone else, self-cover, non-members and unspecified replacements", () => {
    expect(canCreateOverride(ann, { ...handOver, replacesUserId: "bob" }, weekly)).toBe(false);
    expect(canCreateOverride(ann, { ...handOver, userId: "ann" }, weekly)).toBe(false);
    expect(canCreateOverride(ann, { ...handOver, replacesUserId: null }, weekly)).toBe(false);
    const zed = { id: "zed", isManager: false };
    expect(canCreateOverride(zed, { ...handOver, replacesUserId: "zed" }, weekly)).toBe(false);
  });

  it("lets the person who handed over a shift undo it, but not the cover or bystanders", () => {
    const swap = { replacesUserId: "ann" };
    expect(canRemoveOverride({ id: "ann", isManager: false }, swap)).toBe(true);
    expect(canRemoveOverride({ id: "dan", isManager: false }, swap)).toBe(false);
    expect(canRemoveOverride({ id: "bob", isManager: false }, swap)).toBe(false);
    expect(canRemoveOverride({ id: "bob", isManager: true }, swap)).toBe(true);
  });

  it("does not let a cover drop duty a manager assigned (no replaced person)", () => {
    expect(canRemoveOverride({ id: "dan", isManager: false }, { replacesUserId: null })).toBe(false);
  });
});

describe("input parsing", () => {
  it("parses calendar dates and rejects impossible ones", () => {
    expect(parseCalendarDate("2026-02-28")).toEqual({ year: 2026, month: 2, day: 28 });
    expect(parseCalendarDate("2026-02-30")).toBeNull();
    expect(parseCalendarDate("26-02-28")).toBeNull();
  });

  it("reads a local date-time in the schedule's zone", () => {
    expect(parseZonedDateTime("2026-01-15T09:00", "Europe/Berlin").toISOString()).toBe("2026-01-15T08:00:00.000Z");
    expect(parseZonedDateTime("2026-01-15 09:00", "UTC").toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  it("passes full ISO timestamps through and flags garbage", () => {
    expect(parseZonedDateTime("2026-01-15T09:00:00+02:00", "UTC").toISOString()).toBe("2026-01-15T07:00:00.000Z");
    expect(Number.isNaN(parseZonedDateTime("tomorrow", "UTC").getTime())).toBe(true);
    expect(Number.isNaN(parseZonedDateTime("2026-13-40T09:00", "UTC").getTime())).toBe(true);
  });
});

describe("isOnCallEscalationAction", () => {
  it("recognises the on-call step actions only", () => {
    expect(isOnCallEscalationAction("NOTIFY_ONCALL")).toBe(true);
    expect(isOnCallEscalationAction("REASSIGN_ONCALL")).toBe(true);
    expect(isOnCallEscalationAction("NOTIFY")).toBe(false);
    expect(isOnCallEscalationAction("BUMP_PRIORITY")).toBe(false);
  });
});
