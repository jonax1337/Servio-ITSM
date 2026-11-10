import { describe, expect, it } from "vitest";
import {
  easterSunday, generatedYears, isHolidayRegion, planGeneratedHolidays, planManualHolidays, publicHolidays, yearInZone,
  type HolidayRow,
} from "@/lib/public-holidays";

const dates = (region: string, year: number) => publicHolidays(region, year).map((h) => h.date);
const named = (region: string, year: number, name: string) => publicHolidays(region, year).find((h) => h.name === name)?.date;

describe("easterSunday", () => {
  it.each([
    [2024, 3, 31],
    [2025, 4, 20],
    [2026, 4, 5],
    [2027, 3, 28],
    [2028, 4, 16],
    [2029, 4, 1],
    [2038, 4, 25],
  ])("Easter %i is on %i-%i", (year, month, day) => {
    expect(easterSunday(year)).toEqual({ month, day });
  });
});

describe("publicHolidays: Berlin", () => {
  it("2026 has the nationwide days, Frauentag and the Easter-dependent days", () => {
    expect(publicHolidays("DE-BE", 2026)).toEqual([
      { date: "2026-01-01", name: "Neujahr" },
      { date: "2026-03-08", name: "Internationaler Frauentag" },
      { date: "2026-04-03", name: "Karfreitag" },
      { date: "2026-04-06", name: "Ostermontag" },
      { date: "2026-05-01", name: "Tag der Arbeit" },
      { date: "2026-05-14", name: "Christi Himmelfahrt" },
      { date: "2026-05-25", name: "Pfingstmontag" },
      { date: "2026-10-03", name: "Tag der Deutschen Einheit" },
      { date: "2026-12-25", name: "1. Weihnachtstag" },
      { date: "2026-12-26", name: "2. Weihnachtstag" },
    ]);
  });

  it("2027 and 2028 move with Easter", () => {
    expect(dates("DE-BE", 2027)).toEqual([
      "2027-01-01", "2027-03-08", "2027-03-26", "2027-03-29", "2027-05-01", "2027-05-06", "2027-05-17", "2027-10-03", "2027-12-25", "2027-12-26",
    ]);
    expect(dates("DE-BE", 2028)).toEqual([
      "2028-01-01", "2028-03-08", "2028-04-14", "2028-04-17", "2028-05-01", "2028-05-25", "2028-06-05", "2028-10-03", "2028-12-25", "2028-12-26",
    ]);
  });

  it("had no Frauentag before 2019", () => {
    expect(named("DE-BE", 2018, "Internationaler Frauentag")).toBeUndefined();
    expect(named("DE-BE", 2019, "Internationaler Frauentag")).toBe("2019-03-08");
  });

  it("has no Corpus Christi, Reformation Day or Epiphany", () => {
    const names = publicHolidays("DE-BE", 2026).map((h) => h.name);
    expect(names).not.toContain("Fronleichnam");
    expect(names).not.toContain("Reformationstag");
    expect(names).not.toContain("Heilige Drei Könige");
  });
});

describe("publicHolidays: other regions", () => {
  it("DE lists the nationwide holidays only", () => {
    expect(publicHolidays("DE", 2026)).toHaveLength(9);
    expect(named("DE", 2026, "Internationaler Frauentag")).toBeUndefined();
  });

  it("Bavaria adds Epiphany, Corpus Christi and All Saints", () => {
    expect(named("DE-BY", 2026, "Heilige Drei Könige")).toBe("2026-01-06");
    expect(named("DE-BY", 2026, "Fronleichnam")).toBe("2026-06-04");
    expect(named("DE-BY", 2026, "Allerheiligen")).toBe("2026-11-01");
    expect(named("DE-BY", 2026, "Reformationstag")).toBeUndefined();
  });

  it("Saxony has Reformation Day and the Wednesday before 23 November", () => {
    expect(named("DE-SN", 2026, "Reformationstag")).toBe("2026-10-31");
    expect(named("DE-SN", 2026, "Buß- und Bettag")).toBe("2026-11-18");
    expect(named("DE-SN", 2027, "Buß- und Bettag")).toBe("2027-11-17");
    expect(named("DE-SN", 2024, "Buß- und Bettag")).toBe("2024-11-20");
  });

  it("Brandenburg also rests on Easter and Whit Sunday", () => {
    expect(named("DE-BB", 2026, "Ostersonntag")).toBe("2026-04-05");
    expect(named("DE-BB", 2026, "Pfingstsonntag")).toBe("2026-05-24");
  });

  it("Reformation Day came to the northern states in 2018 and was nationwide in 2017", () => {
    expect(named("DE-NI", 2017, "Reformationstag")).toBe("2017-10-31");
    expect(named("DE-BY", 2017, "Reformationstag")).toBe("2017-10-31");
    expect(named("DE-NI", 2016, "Reformationstag")).toBeUndefined();
    expect(named("DE-NI", 2018, "Reformationstag")).toBe("2018-10-31");
    expect(named("DE-SN", 2016, "Reformationstag")).toBe("2016-10-31");
  });

  it("Thuringia has Weltkindertag from 2019; Mecklenburg-Vorpommern Frauentag from 2023", () => {
    expect(named("DE-TH", 2018, "Weltkindertag")).toBeUndefined();
    expect(named("DE-TH", 2026, "Weltkindertag")).toBe("2026-09-20");
    expect(named("DE-MV", 2022, "Internationaler Frauentag")).toBeUndefined();
    expect(named("DE-MV", 2023, "Internationaler Frauentag")).toBe("2023-03-08");
  });

  it("the Saarland keeps the Assumption", () => {
    expect(named("DE-SL", 2026, "Mariä Himmelfahrt")).toBe("2026-08-15");
  });

  it("an unknown region has no holidays", () => {
    expect(publicHolidays("FR", 2026)).toEqual([]);
    expect(publicHolidays("DE-XX", 2026)).toEqual([]);
    expect(isHolidayRegion("DE-BE")).toBe(true);
    expect(isHolidayRegion("DE-XX")).toBe(false);
  });

  it("every state yields sorted, distinct dates", () => {
    for (const code of ["DE", "DE-BW", "DE-BY", "DE-BE", "DE-BB", "DE-HB", "DE-HH", "DE-HE", "DE-MV", "DE-NI", "DE-NW", "DE-RP", "DE-SL", "DE-SN", "DE-ST", "DE-SH", "DE-TH"]) {
      const list = dates(code, 2026);
      expect(list).toEqual([...new Set(list)].sort());
      expect(list.length).toBeGreaterThanOrEqual(9);
    }
  });
});

describe("generatedYears", () => {
  it("is the current and the next year in the calendar's timezone", () => {
    expect(generatedYears(new Date("2026-06-01T12:00:00Z"), "Europe/Berlin")).toEqual([2026, 2027]);
    // New Year's Eve in UTC is already the new year in Berlin.
    expect(yearInZone(new Date("2026-12-31T23:30:00Z"), "Europe/Berlin")).toBe(2027);
    expect(yearInZone(new Date("2026-12-31T23:30:00Z"), "UTC")).toBe(2026);
    expect(yearInZone(new Date("2026-06-01T00:00:00Z"), "Not/AZone")).toBe(2026);
  });
});

describe("planGeneratedHolidays", () => {
  const years = [2026, 2027];
  const desired = [...publicHolidays("DE", 2026), ...publicHolidays("DE", 2027)];
  const row = (id: string, date: string, name: string, generated: boolean): HolidayRow => ({ id, date, name, generated });

  it("creates everything for an empty calendar", () => {
    const plan = planGeneratedHolidays([], desired, years);
    expect(plan.create).toHaveLength(desired.length);
    expect(plan.remove).toEqual([]);
    expect(plan.rename).toEqual([]);
  });

  it("is a no-op when the generated holidays already match", () => {
    const existing = desired.map((h, i) => row(`g${i}`, h.date, h.name, true));
    expect(planGeneratedHolidays(existing, desired, years)).toEqual({ create: [], remove: [], rename: [] });
  });

  it("lets a manual holiday on the same date win and drops the generated one", () => {
    const existing = [row("m1", "2026-12-25", "Betriebsruhe", false), row("g1", "2026-12-25", "1. Weihnachtstag", true)];
    const plan = planGeneratedHolidays(existing, desired, years);
    expect(plan.remove).toEqual(["g1"]);
    expect(plan.create.map((h) => h.date)).not.toContain("2026-12-25");
  });

  it("does not generate on a manual date even when nothing generated exists there yet", () => {
    const plan = planGeneratedHolidays([row("m1", "2027-01-01", "Eigener Name", false)], desired, years);
    expect(plan.create.map((h) => h.date)).not.toContain("2027-01-01");
    expect(plan.remove).toEqual([]);
  });

  it("renames, removes stale and de-duplicates generated rows", () => {
    const existing = [
      row("a", "2026-01-01", "Altname", true),
      row("b", "2026-02-02", "Gibt es nicht", true),
      row("c", "2026-05-01", "Tag der Arbeit", true),
      row("d", "2026-05-01", "Tag der Arbeit", true),
    ];
    const plan = planGeneratedHolidays(existing, desired, years);
    expect(plan.rename).toEqual([{ id: "a", name: "Neujahr" }]);
    expect(plan.remove.sort()).toEqual(["b", "d"]);
  });

  it("keeps generated rows of earlier years as history unless the region changed", () => {
    const old = row("old", "2025-12-25", "1. Weihnachtstag", true);
    expect(planGeneratedHolidays([old], desired, years).remove).toEqual([]);
    expect(planGeneratedHolidays([old], desired, years, true).remove).toEqual(["old"]);
  });

  it("removes everything generated when the region is switched off", () => {
    const existing = [row("g1", "2026-01-01", "Neujahr", true), row("m1", "2026-03-03", "Eigen", false)];
    const plan = planGeneratedHolidays(existing, [], years, true);
    expect(plan).toEqual({ create: [], remove: ["g1"], rename: [] });
  });
});

describe("planManualHolidays", () => {
  it("creates, renames and removes by date", () => {
    const plan = planManualHolidays(
      [{ id: "a", date: "2026-12-24", name: "Heiligabend" }, { id: "b", date: "2026-12-31", name: "Silvester" }, { id: "c", date: "2026-07-01", name: "Altlast" }],
      [{ date: "2026-12-24", name: "Heiligabend (frei)" }, { date: "2026-12-31", name: "Silvester" }, { date: "2027-01-02", name: "Brückentag" }],
    );
    expect(plan).toEqual({
      create: [{ date: "2027-01-02", name: "Brückentag" }],
      remove: ["c"],
      rename: [{ id: "a", name: "Heiligabend (frei)" }],
    });
  });

  it("is a no-op for the same list and drops duplicate dates", () => {
    expect(planManualHolidays([{ id: "a", date: "2026-12-24", name: "X" }], [{ date: "2026-12-24", name: "X" }])).toEqual({ create: [], remove: [], rename: [] });
    expect(planManualHolidays([{ id: "a", date: "2026-12-24", name: "X" }, { id: "b", date: "2026-12-24", name: "X" }], [{ date: "2026-12-24", name: "X" }]).remove).toEqual(["b"]);
  });
});
