import { describe, expect, it } from "vitest";
import {
  conflictsOf,
  daysInRange,
  findConflicts,
  freezeAppliesTo,
  freezeHits,
  freezeState,
  freezeVerdict,
  freezeWindowError,
  matchesFilter,
  otherChangeId,
  parseAnchor,
  parseCalendarView,
  shiftAnchor,
  visibleRange,
  windowsOverlap,
  type FreezeWindow,
  type ScheduledChange,
} from "@/lib/change-schedule-rules";

const at = (iso: string) => new Date(iso);
const win = (start: string, end: string) => ({ start: at(start), end: at(end) });

function change(id: number, start: string, end: string, overrides: Partial<ScheduledChange> = {}): ScheduledChange {
  return {
    id,
    title: `Change ${id}`,
    status: "APPROVED",
    type: "NORMAL",
    risk: "MEDIUM",
    groupId: null,
    plannedStart: at(start),
    plannedEnd: at(end),
    assetIds: [],
    serviceIds: [],
    ...overrides,
  };
}

function freeze(overrides: Partial<FreezeWindow> = {}): FreezeWindow {
  return {
    id: "f1",
    name: "Year-end freeze",
    reason: null,
    startsAt: at("2026-12-20T00:00"),
    endsAt: at("2026-12-28T00:00"),
    serviceId: null,
    groupId: null,
    ...overrides,
  };
}

describe("windowsOverlap", () => {
  it("detects partial, contained and identical overlaps", () => {
    expect(windowsOverlap(win("2026-01-01T10:00", "2026-01-01T12:00"), win("2026-01-01T11:00", "2026-01-01T13:00"))).toBe(true);
    expect(windowsOverlap(win("2026-01-01T10:00", "2026-01-01T18:00"), win("2026-01-01T11:00", "2026-01-01T12:00"))).toBe(true);
    expect(windowsOverlap(win("2026-01-01T10:00", "2026-01-01T12:00"), win("2026-01-01T10:00", "2026-01-01T12:00"))).toBe(true);
  });

  it("treats windows that only touch as not overlapping", () => {
    expect(windowsOverlap(win("2026-01-01T10:00", "2026-01-01T12:00"), win("2026-01-01T12:00", "2026-01-01T14:00"))).toBe(false);
    expect(windowsOverlap(win("2026-01-01T12:00", "2026-01-01T14:00"), win("2026-01-01T10:00", "2026-01-01T12:00"))).toBe(false);
  });

  it("rejects disjoint windows", () => {
    expect(windowsOverlap(win("2026-01-01T10:00", "2026-01-01T11:00"), win("2026-01-02T10:00", "2026-01-02T11:00"))).toBe(false);
  });
});

describe("findConflicts", () => {
  const overlapping = ["2026-03-01T10:00", "2026-03-01T14:00"] as const;
  const alsoOverlapping = ["2026-03-01T12:00", "2026-03-01T16:00"] as const;

  it("flags overlapping changes that share a CI", () => {
    const conflicts = findConflicts(
      [change(2, ...alsoOverlapping, { assetIds: ["a", "b"] }), change(1, ...overlapping, { assetIds: ["b", "c"] })],
      { sameService: false },
    );
    expect(conflicts).toEqual([{ first: 1, second: 2, sharedAssetIds: ["b"], sharedServiceIds: [] }]);
  });

  it("ignores overlapping changes without a shared CI", () => {
    const conflicts = findConflicts(
      [change(1, ...overlapping, { assetIds: ["a"] }), change(2, ...alsoOverlapping, { assetIds: ["b"] })],
      { sameService: false },
    );
    expect(conflicts).toEqual([]);
  });

  it("ignores changes sharing a CI whose windows do not overlap", () => {
    const conflicts = findConflicts(
      [change(1, "2026-03-01T10:00", "2026-03-01T12:00", { assetIds: ["a"] }), change(2, "2026-03-01T12:00", "2026-03-01T14:00", { assetIds: ["a"] })],
      { sameService: true },
    );
    expect(conflicts).toEqual([]);
  });

  it("flags a shared service through different CIs only when same-service detection is on", () => {
    const changes = [
      change(1, ...overlapping, { assetIds: ["a"], serviceIds: ["svc"] }),
      change(2, ...alsoOverlapping, { assetIds: ["b"], serviceIds: ["svc"] }),
    ];
    expect(findConflicts(changes, { sameService: false })).toEqual([]);
    expect(findConflicts(changes, { sameService: true })).toEqual([
      { first: 1, second: 2, sharedAssetIds: [], sharedServiceIds: ["svc"] },
    ]);
  });

  it("skips settled changes", () => {
    for (const status of ["CANCELLED", "REJECTED", "FAILED", "CLOSED"]) {
      const conflicts = findConflicts(
        [change(1, ...overlapping, { assetIds: ["a"] }), change(2, ...alsoOverlapping, { assetIds: ["a"], status })],
        { sameService: true },
      );
      expect(conflicts, status).toEqual([]);
    }
  });

  it("finds every pair among three changes and does not mutate its input", () => {
    const input = [
      change(3, "2026-03-01T12:30", "2026-03-01T13:00", { assetIds: ["a"] }),
      change(1, ...overlapping, { assetIds: ["a"] }),
      change(2, ...alsoOverlapping, { assetIds: ["a"] }),
    ];
    const conflicts = findConflicts(input, { sameService: false });
    expect(conflicts.map((c) => [c.first, c.second])).toEqual([[1, 2], [1, 3], [2, 3]]);
    expect(input.map((c) => c.id)).toEqual([3, 1, 2]);
  });
});

describe("conflictsOf / otherChangeId", () => {
  const conflicts = [
    { first: 1, second: 2, sharedAssetIds: ["a"], sharedServiceIds: [] },
    { first: 2, second: 3, sharedAssetIds: ["b"], sharedServiceIds: [] },
  ];

  it("returns only the pairs a change takes part in", () => {
    expect(conflictsOf(2, conflicts)).toHaveLength(2);
    expect(conflictsOf(1, conflicts)).toEqual([conflicts[0]]);
    expect(conflictsOf(9, conflicts)).toEqual([]);
  });

  it("names the other side of a pair", () => {
    expect(otherChangeId(1, conflicts[0])).toBe(2);
    expect(otherChangeId(2, conflicts[0])).toBe(1);
  });
});

describe("freezeAppliesTo", () => {
  it("binds every change when the freeze is global", () => {
    expect(freezeAppliesTo(freeze(), { groupId: null, serviceIds: [] })).toBe(true);
  });

  it("binds only changes touching the scoped service", () => {
    const scoped = freeze({ serviceId: "svc" });
    expect(freezeAppliesTo(scoped, { groupId: null, serviceIds: ["svc", "other"] })).toBe(true);
    expect(freezeAppliesTo(scoped, { groupId: null, serviceIds: ["other"] })).toBe(false);
  });

  it("binds only changes owned by the scoped team", () => {
    const scoped = freeze({ groupId: "team" });
    expect(freezeAppliesTo(scoped, { groupId: "team", serviceIds: [] })).toBe(true);
    expect(freezeAppliesTo(scoped, { groupId: "else", serviceIds: [] })).toBe(false);
    expect(freezeAppliesTo(scoped, { groupId: null, serviceIds: [] })).toBe(false);
  });

  it("requires every set scope to match", () => {
    const scoped = freeze({ serviceId: "svc", groupId: "team" });
    expect(freezeAppliesTo(scoped, { groupId: "team", serviceIds: ["svc"] })).toBe(true);
    expect(freezeAppliesTo(scoped, { groupId: "team", serviceIds: [] })).toBe(false);
    expect(freezeAppliesTo(scoped, { groupId: "else", serviceIds: ["svc"] })).toBe(false);
  });
});

describe("freezeHits", () => {
  const subject = { groupId: null, serviceIds: [] };

  it("returns the freezes overlapping the window", () => {
    const hits = freezeHits(win("2026-12-24T10:00", "2026-12-24T12:00"), subject, [freeze()]);
    expect(hits.map((f) => f.id)).toEqual(["f1"]);
  });

  it("does not hit a window that ends when the freeze starts or starts when it ends", () => {
    expect(freezeHits(win("2026-12-19T00:00", "2026-12-20T00:00"), subject, [freeze()])).toEqual([]);
    expect(freezeHits(win("2026-12-28T00:00", "2026-12-28T02:00"), subject, [freeze()])).toEqual([]);
  });

  it("skips freezes that do not apply to the change", () => {
    const hits = freezeHits(win("2026-12-24T10:00", "2026-12-24T12:00"), subject, [freeze({ serviceId: "svc" })]);
    expect(hits).toEqual([]);
  });
});

describe("freezeVerdict", () => {
  const hit = freeze();

  it("allows a change outside every freeze without a comment", () => {
    expect(freezeVerdict({ type: "NORMAL", hits: [], justification: null })).toEqual({ ok: true, overrideComment: null });
  });

  it("refuses a non-emergency change inside a freeze, naming the freeze", () => {
    for (const type of ["STANDARD", "NORMAL"]) {
      const verdict = freezeVerdict({ type, hits: [hit], justification: "please" });
      expect(verdict.ok, type).toBe(false);
      if (!verdict.ok) {
        expect(verdict.needsJustification).toBe(false);
        expect(verdict.error).toContain("Year-end freeze");
      }
    }
  });

  it("asks an emergency change inside a freeze for a justification", () => {
    for (const justification of [null, "", "   "]) {
      const verdict = freezeVerdict({ type: "EMERGENCY", hits: [hit], justification });
      expect(verdict).toMatchObject({ ok: false, needsJustification: true });
    }
  });

  it("lets a justified emergency change through and records why", () => {
    const verdict = freezeVerdict({ type: "EMERGENCY", hits: [hit], justification: "  Prod DB is down  " });
    expect(verdict).toMatchObject({ ok: true });
    if (verdict.ok) {
      expect(verdict.overrideComment).toContain("Year-end freeze");
      expect(verdict.overrideComment).toContain("Prod DB is down");
    }
  });

  it("needs no justification for an emergency change outside every freeze", () => {
    expect(freezeVerdict({ type: "EMERGENCY", hits: [], justification: null })).toEqual({ ok: true, overrideComment: null });
  });
});

describe("freezeState", () => {
  const f = freeze();

  it("classifies a freeze relative to now", () => {
    expect(freezeState(f, at("2026-12-01T00:00"))).toBe("upcoming");
    expect(freezeState(f, at("2026-12-24T00:00"))).toBe("active");
    expect(freezeState(f, at("2026-12-29T00:00"))).toBe("past");
  });

  it("is active from its first instant and past from its last", () => {
    expect(freezeState(f, f.startsAt)).toBe("active");
    expect(freezeState(f, f.endsAt)).toBe("past");
  });
});

describe("freezeWindowError", () => {
  it("requires the end to come after the start", () => {
    expect(freezeWindowError(at("2026-01-01T10:00"), at("2026-01-01T11:00"))).toBeNull();
    expect(freezeWindowError(at("2026-01-01T10:00"), at("2026-01-01T10:00"))).not.toBeNull();
    expect(freezeWindowError(at("2026-01-01T11:00"), at("2026-01-01T10:00"))).not.toBeNull();
  });
});

describe("calendar range", () => {
  // Local-time anchor: 2026-03-18 is a Wednesday.
  const anchor = new Date(2026, 2, 18);

  it("spans whole Monday-first weeks around the month", () => {
    const range = visibleRange("month", anchor);
    expect(range.start).toEqual(new Date(2026, 1, 23)); // Mon 23 Feb
    expect(range.end).toEqual(new Date(2026, 3, 6)); // exclusive: Mon 6 Apr
    const days = daysInRange(range);
    expect(days).toHaveLength(42);
    expect(days.every((d) => d.getHours() === 0)).toBe(true);
  });

  it("spans the Monday-to-Sunday week of the anchor", () => {
    const range = visibleRange("week", anchor);
    expect(range.start).toEqual(new Date(2026, 2, 16));
    expect(range.end).toEqual(new Date(2026, 2, 23));
    expect(daysInRange(range)).toHaveLength(7);
  });

  it("shifts by a month or a week", () => {
    expect(shiftAnchor("month", anchor, 1)).toEqual(new Date(2026, 3, 18));
    expect(shiftAnchor("month", anchor, -1)).toEqual(new Date(2026, 1, 18));
    expect(shiftAnchor("week", anchor, 1)).toEqual(new Date(2026, 2, 25));
  });
});

describe("calendar params", () => {
  const today = new Date(2026, 5, 10, 15, 30);

  it("falls back to the default view for unknown values", () => {
    expect(parseCalendarView("week")).toBe("week");
    expect(parseCalendarView("month")).toBe("month");
    expect(parseCalendarView("year")).toBe("month");
    expect(parseCalendarView(undefined)).toBe("month");
  });

  it("parses a valid anchor and falls back to today's start otherwise", () => {
    expect(parseAnchor("2026-02-03", today)).toEqual(new Date(2026, 1, 3));
    expect(parseAnchor("garbage", today)).toEqual(new Date(2026, 5, 10));
    expect(parseAnchor("2026-13-45", today)).toEqual(new Date(2026, 5, 10));
    expect(parseAnchor(undefined, today)).toEqual(new Date(2026, 5, 10));
  });
});

describe("matchesFilter", () => {
  const c = change(1, "2026-03-01T10:00", "2026-03-01T11:00", { groupId: "team", risk: "HIGH", status: "SCHEDULED" });

  it("passes everything without restrictions or with 'all'", () => {
    expect(matchesFilter(c, {})).toBe(true);
    expect(matchesFilter(c, { groupId: "all", risk: "all", status: "all" })).toBe(true);
  });

  it("requires every set filter to match", () => {
    expect(matchesFilter(c, { groupId: "team", risk: "HIGH", status: "SCHEDULED" })).toBe(true);
    expect(matchesFilter(c, { groupId: "team", risk: "LOW" })).toBe(false);
    expect(matchesFilter(c, { status: "DRAFT" })).toBe(false);
    expect(matchesFilter(c, { groupId: "other" })).toBe(false);
  });
});
