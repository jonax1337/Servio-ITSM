import { describe, expect, it } from "vitest";
import {
  creationTimeFor,
  describeRecurrence,
  indexOnOrAfter,
  initialNextDue,
  leadTimeError,
  localDateTimeParts,
  nextToCreate,
  occurrenceAt,
  occurrenceOnOrAfter,
  type Recurrence,
} from "@/lib/recurring-ticket-rules";

const at = (iso: string) => new Date(iso);
const iso = (d: Date) => d.toISOString();
const BERLIN = "Europe/Berlin";

function rule(overrides: Partial<Recurrence> & Pick<Recurrence, "firstDueAt">): Recurrence {
  return { frequency: "MONTHLY", interval: 1, timezone: BERLIN, createBeforeDays: 0, ...overrides };
}

const series = (r: Recurrence, count: number) => Array.from({ length: count }, (_, n) => iso(occurrenceAt(r, n)));

describe("occurrenceAt — month ends and leap years", () => {
  it("clamps the 31st to shorter months without drifting (Jan 31 → Feb 28 → Mar 31 → Apr 30)", () => {
    // 09:00 Berlin: CET (+1) until 28 Mar 2027, CEST (+2) after.
    const r = rule({ firstDueAt: at("2027-01-31T08:00:00Z") });
    expect(series(r, 4)).toEqual([
      "2027-01-31T08:00:00.000Z",
      "2027-02-28T08:00:00.000Z",
      "2027-03-31T07:00:00.000Z",
      "2027-04-30T07:00:00.000Z",
    ]);
  });

  it("lands on Feb 29 in a leap year", () => {
    const r = rule({ firstDueAt: at("2028-01-31T08:00:00Z") });
    expect(iso(occurrenceAt(r, 1))).toBe("2028-02-29T08:00:00.000Z");
  });

  it("keeps a yearly Feb 29 on Feb 28 in common years and returns to Feb 29 in the next leap year", () => {
    const r = rule({ frequency: "YEARLY", firstDueAt: at("2028-02-29T08:00:00Z") });
    expect(iso(occurrenceAt(r, 1))).toBe("2029-02-28T08:00:00.000Z");
    expect(iso(occurrenceAt(r, 4))).toBe("2032-02-29T08:00:00.000Z");
  });

  it("steps every N months across a year boundary", () => {
    const r = rule({ interval: 3, firstDueAt: at("2026-11-30T08:00:00Z") });
    expect(series(r, 3)).toEqual(["2026-11-30T08:00:00.000Z", "2027-02-28T08:00:00.000Z", "2027-05-30T07:00:00.000Z"]);
  });

  it("steps weekly with an interval", () => {
    const r = rule({ frequency: "WEEKLY", interval: 2, firstDueAt: at("2026-11-09T08:00:00Z") });
    expect(series(r, 3)).toEqual(["2026-11-09T08:00:00.000Z", "2026-11-23T08:00:00.000Z", "2026-12-07T08:00:00.000Z"]);
  });
});

describe("occurrenceAt — DST in Europe/Berlin", () => {
  it("keeps the wall-clock time across the spring-forward change", () => {
    const r = rule({ frequency: "DAILY", firstDueAt: at("2027-03-27T08:00:00Z") }); // 09:00 CET
    expect(iso(occurrenceAt(r, 1))).toBe("2027-03-28T07:00:00.000Z"); // 09:00 CEST
  });

  it("keeps the wall-clock time across the fall-back change", () => {
    const r = rule({ frequency: "DAILY", firstDueAt: at("2026-10-24T07:00:00Z") }); // 09:00 CEST
    expect(iso(occurrenceAt(r, 1))).toBe("2026-10-25T08:00:00.000Z"); // 09:00 CET
  });

  it("moves a due time inside the spring-forward gap forward by the gap", () => {
    const r = rule({ frequency: "DAILY", firstDueAt: at("2027-03-27T01:30:00Z") }); // 02:30 CET
    const next = occurrenceAt(r, 1);
    expect(iso(next)).toBe("2027-03-28T01:30:00.000Z"); // 03:30 CEST (02:30 does not exist)
    expect(localDateTimeParts(next, BERLIN)).toEqual({ date: "2027-03-28", time: "03:30" });
    expect(iso(occurrenceAt(r, 2))).toBe("2027-03-29T00:30:00.000Z"); // back to 02:30 CEST
  });

  it("treats an unknown zone as UTC", () => {
    const r = rule({ frequency: "DAILY", timezone: "Mars/Olympus", firstDueAt: at("2027-03-27T08:00:00Z") });
    expect(iso(occurrenceAt(r, 1))).toBe("2027-03-28T08:00:00.000Z");
  });
});

describe("indexOnOrAfter", () => {
  it("matches a brute-force search over long spans", () => {
    const rules: Recurrence[] = [
      rule({ frequency: "DAILY", firstDueAt: at("2020-01-01T08:00:00Z") }),
      rule({ frequency: "WEEKLY", interval: 3, firstDueAt: at("2020-01-31T08:00:00Z") }),
      rule({ frequency: "MONTHLY", firstDueAt: at("2020-01-31T08:00:00Z") }),
      rule({ frequency: "YEARLY", firstDueAt: at("2020-02-29T08:00:00Z") }),
    ];
    const probes = ["2019-06-01T00:00:00Z", "2020-01-01T08:00:00Z", "2024-02-29T07:59:00Z", "2031-07-15T12:00:00Z"].map(at);
    for (const r of rules) {
      for (const t of probes) {
        let n = 0;
        while (occurrenceAt(r, n).getTime() < t.getTime()) n++;
        expect(indexOnOrAfter(r, t)).toBe(n);
      }
    }
  });

  it("returns the occurrence itself when t is exactly on it", () => {
    const r = rule({ firstDueAt: at("2027-01-31T08:00:00Z") });
    expect(iso(occurrenceOnOrAfter(r, at("2027-02-28T08:00:00Z")))).toBe("2027-02-28T08:00:00.000Z");
    expect(iso(occurrenceOnOrAfter(r, at("2027-02-28T08:00:01Z")))).toBe("2027-03-31T07:00:00.000Z");
  });
});

describe("creationTimeFor", () => {
  it("is the due time itself without a lead time", () => {
    const r = rule({ firstDueAt: at("2027-03-31T07:00:00Z") });
    expect(iso(creationTimeFor(r, r.firstDueAt))).toBe("2027-03-31T07:00:00.000Z");
  });

  it("counts lead days on the local calendar, at the same wall-clock time (across DST)", () => {
    const r = rule({ createBeforeDays: 7, firstDueAt: at("2027-03-31T07:00:00Z") }); // 09:00 CEST
    expect(iso(creationTimeFor(r, r.firstDueAt))).toBe("2027-03-24T08:00:00.000Z"); // 09:00 CET
  });
});

describe("initialNextDue", () => {
  const r = rule({ firstDueAt: at("2027-01-10T08:00:00Z") });

  it("starts at the first occurrence when it is still ahead", () => {
    expect(iso(initialNextDue(r, at("2026-12-01T00:00:00Z"), null))).toBe("2027-01-10T08:00:00.000Z");
  });

  it("skips occurrences that are already due (no retroactive tickets)", () => {
    expect(iso(initialNextDue(r, at("2027-04-11T00:00:00Z"), null))).toBe("2027-05-10T07:00:00.000Z");
  });

  it("keeps an occurrence that is not due yet even if its creation window is open", () => {
    expect(iso(initialNextDue({ ...r, createBeforeDays: 7 }, at("2027-04-05T00:00:00Z"), null))).toBe("2027-04-10T07:00:00.000Z");
  });

  it("never returns an occurrence that already has its ticket", () => {
    // The ticket for 10 Apr was created early (lead time); resuming on 5 Apr goes on with May.
    expect(iso(initialNextDue(r, at("2027-04-05T00:00:00Z"), at("2027-04-10T07:00:00Z")))).toBe("2027-05-10T07:00:00.000Z");
  });
});

describe("nextToCreate", () => {
  // Monthly on the 10th at 09:00 Berlin, created 7 days ahead.
  const r = rule({ createBeforeDays: 7, firstDueAt: at("2026-01-10T08:00:00Z") });

  it("waits until the creation window opens", () => {
    expect(nextToCreate(r, at("2026-11-10T08:00:00Z"), at("2026-11-03T07:59:00Z"))).toBeNull();
  });

  it("creates the occurrence once its window is open and moves on to the next one", () => {
    expect(nextToCreate(r, at("2026-11-10T08:00:00Z"), at("2026-11-03T08:00:00Z"))).toEqual({
      dueAt: at("2026-11-10T08:00:00Z"),
      nextDueAt: at("2026-12-10T08:00:00Z"),
      skipped: 0,
    });
  });

  it("catches up only the latest missed occurrence after a downtime", () => {
    // Down from August until 5 Nov: Aug, Sep and Oct fell due unseen.
    const plan = nextToCreate(r, at("2026-08-10T07:00:00Z"), at("2026-11-05T12:00:00Z"));
    expect(plan).toEqual({ dueAt: at("2026-10-10T07:00:00Z"), nextDueAt: at("2026-11-10T08:00:00Z"), skipped: 2 });
    // …then the open November occurrence follows, and nothing after it.
    const then = nextToCreate(r, plan!.nextDueAt, at("2026-11-05T12:00:00Z"));
    expect(then).toEqual({ dueAt: at("2026-11-10T08:00:00Z"), nextDueAt: at("2026-12-10T08:00:00Z"), skipped: 0 });
    expect(nextToCreate(r, then!.nextDueAt, at("2026-11-05T12:00:00Z"))).toBeNull();
  });

  it("'create now' creates the next occurrence early, ignoring the window", () => {
    expect(nextToCreate(r, at("2026-12-10T08:00:00Z"), at("2026-11-20T00:00:00Z"), { force: true })).toEqual({
      dueAt: at("2026-12-10T08:00:00Z"),
      nextDueAt: at("2027-01-10T08:00:00Z"),
      skipped: 0,
    });
  });

  it("'create now' on a stale schedule takes the next occurrence that isn't due yet", () => {
    expect(nextToCreate(r, at("2026-08-10T07:00:00Z"), at("2026-11-20T00:00:00Z"), { force: true })).toEqual({
      dueAt: at("2026-12-10T08:00:00Z"),
      nextDueAt: at("2027-01-10T08:00:00Z"),
      skipped: 4,
    });
  });

  it("creates exactly one ticket per occurrence, createBeforeDays ahead, over a year of hourly ticks", () => {
    let nextDueAt = initialNextDue(r, at("2026-10-01T00:00:00Z"), null);
    const created: { dueAt: string; at: string }[] = [];
    const end = at("2027-10-01T00:00:00Z").getTime();
    for (let t = at("2026-10-01T00:00:00Z").getTime(); t < end; t += 3_600_000) {
      const now = new Date(t);
      for (let plan = nextToCreate(r, nextDueAt, now); plan; plan = nextToCreate(r, nextDueAt, now)) {
        created.push({ dueAt: iso(plan.dueAt), at: iso(now) });
        nextDueAt = plan.nextDueAt;
      }
    }
    expect(created).toHaveLength(12);
    expect(new Set(created.map((c) => c.dueAt)).size).toBe(12);
    for (const c of created) {
      // Each ticket appears on the first hourly tick at or after its creation time.
      const opens = creationTimeFor(r, at(c.dueAt)).getTime();
      expect(at(c.at).getTime() - opens).toBeGreaterThanOrEqual(0);
      expect(at(c.at).getTime() - opens).toBeLessThan(3_600_000);
    }
    expect(created[0]).toEqual({ dueAt: "2026-10-10T07:00:00.000Z", at: "2026-10-03T07:00:00.000Z" });
  });
});

describe("leadTimeError", () => {
  it("allows lead times shorter than one step", () => {
    expect(leadTimeError("DAILY", 1, 0)).toBeNull();
    expect(leadTimeError("WEEKLY", 2, 13)).toBeNull();
    expect(leadTimeError("MONTHLY", 1, 27)).toBeNull();
    expect(leadTimeError("YEARLY", 1, 364)).toBeNull();
  });

  it("refuses lead times that would open two occurrences at once", () => {
    expect(leadTimeError("DAILY", 1, 1)).toMatch(/can't be created ahead/);
    expect(leadTimeError("MONTHLY", 1, 28)).toBe("Create the ticket at most 27 days ahead for every month.");
    expect(leadTimeError("WEEKLY", 1, 7)).toMatch(/at most 6 days/);
  });
});

describe("describeRecurrence", () => {
  it("names the step", () => {
    expect(describeRecurrence("DAILY", 1)).toBe("Every day");
    expect(describeRecurrence("MONTHLY", 3)).toBe("Every 3 months");
    expect(describeRecurrence("YEARLY", 2)).toBe("Every 2 years");
  });
});
