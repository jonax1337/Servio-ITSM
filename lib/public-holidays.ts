/**
 * Rule-based public holidays for business calendars. Pure and DB-free, so the dates are
 * unit-testable; lib/holiday-sync.ts writes them into a calendar.
 *
 * A calendar picks a region (`holidayRegion`: `DE` for the nationwide holidays only, or `DE-BE`,
 * `DE-BY`, ... for one German federal state) and gets that region's statutory holidays for the
 * current and the following year, Easter-dependent days included. Names are the official German
 * ones. Holidays that apply only in some municipalities of a state (e.g. Corpus Christi in parts
 * of Saxony and Thuringia, the Assumption in parts of Bavaria, the Augsburg peace festival) are
 * not included: add those as manual holidays.
 */

/** The German federal states by their ISO 3166-2 suffix. */
export const GERMAN_STATES = [
  "BW", "BY", "BE", "BB", "HB", "HH", "HE", "MV", "NI", "NW", "RP", "SL", "SN", "ST", "SH", "TH",
] as const;
export type GermanState = (typeof GERMAN_STATES)[number];

/** Region codes a calendar may use: `DE` (federal holidays only) and `DE-<state>`. */
export const HOLIDAY_REGIONS = ["DE", ...GERMAN_STATES.map((s) => `DE-${s}` as const)] as const;
export type HolidayRegion = (typeof HOLIDAY_REGIONS)[number];

export function isHolidayRegion(value: string): value is HolidayRegion {
  return (HOLIDAY_REGIONS as readonly string[]).includes(value);
}

/** One public holiday: the calendar day (`YYYY-MM-DD`) and its name. */
export type PublicHoliday = { date: string; name: string };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

/** `year`-`month`-`day` shifted by `days`, as a `YYYY-MM-DD` string (UTC arithmetic, so no DST surprises). */
function shift(year: number, month: number, day: number, days: number): string {
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Easter Sunday of `year` in the Gregorian calendar (Meeus/Jones/Butcher algorithm). */
export function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** The Wednesday before 23 November (Buß- und Bettag), i.e. the Wednesday between 16 and 22 November. */
function repentanceDay(year: number): string {
  for (let day = 22; day >= 16; day--) {
    if (new Date(Date.UTC(year, 10, day)).getUTCDay() === 3) return ymd(year, 11, day);
  }
  throw new Error("unreachable: every 7-day span holds a Wednesday");
}

type Rule = {
  name: string;
  /** The day in `year`, as `YYYY-MM-DD`. */
  on: (year: number) => string;
  /** States that observe it; omitted = nationwide. */
  states?: readonly GermanState[];
  /** First year it applies (omitted = always), per state when it differs. */
  since?: number | Partial<Record<GermanState, number>>;
  /** Years that apply in every state on top of the rule (a one-off nationwide holiday). */
  extraYears?: readonly number[];
};

const fixed = (month: number, day: number) => (year: number) => ymd(year, month, day);
const easter = (offset: number) => (year: number) => {
  const { month, day } = easterSunday(year);
  return shift(year, month, day, offset);
};

const RULES: readonly Rule[] = [
  { name: "Neujahr", on: fixed(1, 1) },
  { name: "Heilige Drei Könige", on: fixed(1, 6), states: ["BW", "BY", "ST"] },
  { name: "Internationaler Frauentag", on: fixed(3, 8), states: ["BE", "MV"], since: { BE: 2019, MV: 2023 } },
  { name: "Karfreitag", on: easter(-2) },
  { name: "Ostersonntag", on: easter(0), states: ["BB"] },
  { name: "Ostermontag", on: easter(1) },
  { name: "Tag der Arbeit", on: fixed(5, 1) },
  { name: "Christi Himmelfahrt", on: easter(39) },
  { name: "Pfingstsonntag", on: easter(49), states: ["BB"] },
  { name: "Pfingstmontag", on: easter(50) },
  { name: "Fronleichnam", on: easter(60), states: ["BW", "BY", "HE", "NW", "RP", "SL"] },
  { name: "Mariä Himmelfahrt", on: fixed(8, 15), states: ["SL"] },
  { name: "Weltkindertag", on: fixed(9, 20), states: ["TH"], since: 2019 },
  { name: "Tag der Deutschen Einheit", on: fixed(10, 3), since: 1990 },
  {
    name: "Reformationstag",
    on: fixed(10, 31),
    states: ["BB", "HB", "HH", "MV", "NI", "SN", "ST", "SH", "TH"],
    since: { HB: 2018, HH: 2018, NI: 2018, SH: 2018 },
    // The 500th anniversary of the Reformation was a nationwide holiday once.
    extraYears: [2017],
  },
  { name: "Allerheiligen", on: fixed(11, 1), states: ["BW", "BY", "NW", "RP", "SL"] },
  { name: "Buß- und Bettag", on: repentanceDay, states: ["SN"] },
  { name: "1. Weihnachtstag", on: fixed(12, 25) },
  { name: "2. Weihnachtstag", on: fixed(12, 26) },
];

function appliesIn(rule: Rule, state: GermanState | null, year: number): boolean {
  if (rule.extraYears?.includes(year)) return true;
  if (rule.states && (state === null || !rule.states.includes(state))) return false;
  const since = typeof rule.since === "number" ? rule.since : state ? rule.since?.[state] : undefined;
  return since === undefined || year >= since;
}

/**
 * The public holidays of `region` in `year`, sorted by date. A region that is not a known code
 * has none. `DE` lists the nationwide holidays only; a state adds its own.
 */
export function publicHolidays(region: string, year: number): PublicHoliday[] {
  if (!isHolidayRegion(region) || !Number.isInteger(year)) return [];
  const state = region === "DE" ? null : (region.slice(3) as GermanState);
  return RULES.filter((rule) => appliesIn(rule, state, year))
    .map((rule) => ({ date: rule.on(year), name: rule.name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** How many calendar years ahead (besides the current one) holidays are generated. */
export const GENERATED_YEARS_AHEAD = 1;

/** The calendar year `now` falls in as seen in `timezone` (an invalid zone counts as UTC). */
export function yearInZone(now: Date, timezone: string): number {
  try {
    const year = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" }).format(now);
    return Number(year);
  } catch {
    return now.getUTCFullYear();
  }
}

/** The years a calendar holds generated holidays for: the current one and the following one. */
export function generatedYears(now: Date, timezone: string): number[] {
  const first = yearInZone(now, timezone);
  return Array.from({ length: GENERATED_YEARS_AHEAD + 1 }, (_, i) => first + i);
}

export type HolidayRow = { id: string; date: string; name: string; generated: boolean };

export type HolidayPlan = {
  create: PublicHoliday[];
  /** Existing generated rows to delete (stale, duplicated or overridden by a manual holiday). */
  remove: string[];
  /** Existing generated rows whose name has to follow the rule. */
  rename: { id: string; name: string }[];
};

/**
 * What it takes to make the generated holidays of `years` equal `desired`. A manual holiday on a date
 * wins: no generated one is kept on it. Generated rows outside `years` are left alone unless
 * `dropOutside` (the region changed or was switched off), which also removes them.
 */
export function planGeneratedHolidays(
  existing: readonly HolidayRow[],
  desired: readonly PublicHoliday[],
  years: readonly number[],
  dropOutside = false,
): HolidayPlan {
  const inWindow = (date: string) => years.includes(Number(date.slice(0, 4)));
  const manualDates = new Set(existing.filter((h) => !h.generated).map((h) => h.date));
  const target = new Map<string, string>();
  for (const h of desired) if (!manualDates.has(h.date) && !target.has(h.date)) target.set(h.date, h.name);

  const plan: HolidayPlan = { create: [], remove: [], rename: [] };
  const kept = new Set<string>();
  for (const row of existing.filter((h) => h.generated)) {
    if (!inWindow(row.date)) {
      if (dropOutside) plan.remove.push(row.id);
      continue;
    }
    const name = target.get(row.date);
    if (name === undefined || kept.has(row.date)) {
      plan.remove.push(row.id);
      continue;
    }
    kept.add(row.date);
    if (row.name !== name) plan.rename.push({ id: row.id, name });
  }
  for (const [date, name] of target) if (!kept.has(date)) plan.create.push({ date, name });
  plan.create.sort((a, b) => a.date.localeCompare(b.date));
  return plan;
}

export type ManualHolidayPlan = {
  create: PublicHoliday[];
  remove: string[];
  rename: { id: string; name: string }[];
};

/**
 * What it takes to make the manual holidays equal `requested` (one per date): missing dates are created,
 * a date with another name is renamed, dates that are not requested any more are removed.
 */
export function planManualHolidays(
  current: readonly { id: string; date: string; name: string }[],
  requested: readonly PublicHoliday[],
): ManualHolidayPlan {
  const wanted = new Map(requested.map((h) => [h.date, h.name]));
  const plan: ManualHolidayPlan = { create: [], remove: [], rename: [] };
  const seen = new Set<string>();
  for (const row of current) {
    const name = wanted.get(row.date);
    if (name === undefined || seen.has(row.date)) plan.remove.push(row.id);
    else {
      seen.add(row.date);
      if (row.name !== name) plan.rename.push({ id: row.id, name });
    }
  }
  for (const [date, name] of wanted) if (!seen.has(date)) plan.create.push({ date, name });
  plan.create.sort((a, b) => a.date.localeCompare(b.date));
  return plan;
}
