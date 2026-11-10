// ---------------------------------------------------------------------------
// Business-hours math. Pure, DB-free functions that compute ELAPSED BUSINESS
// time between two instants (and the reverse: add a business-duration to a
// start instant to get a deadline) given a business calendar: a timezone, a
// weekly open/close schedule, and a set of holiday dates.
//
// The calendar is passed in — this module never touches the DB, so it is easy
// to unit-test and cheap to call. lib/sla.ts loads the BusinessCalendar
// (+holidays) and feeds it here.
//
// weeklyHours JSON shape (matches the `String @default("{}")` column):
//   { "mon": [["09:00","17:00"]], "tue": [["09:00","12:00"],["13:00","17:00"]], ... }
// Keys are the lowercase 3-letter weekday names below. A day with no entry (or
// an empty array) is fully closed. Multiple windows per day are supported
// (e.g. a lunch break). Times are wall-clock in the calendar's timezone,
// "HH:MM" 24h. Holidays are whole closed days keyed by their calendar-local
// Y-M-D.
// ---------------------------------------------------------------------------

export const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

/** One [openMinutes, closeMinutes] window inside a day (minutes from midnight). */
type Window = [number, number];

export type BusinessCalendarLike = {
  timezone: string;
  weeklyHours: string; // JSON string (see header) or already-parsed object is also accepted
  holidays?: { date: Date | string }[];
};

// A normalized, parsed calendar the internal helpers work with.
type ParsedCalendar = {
  timezone: string;
  // index 0..6 (sun..sat) → sorted, non-overlapping windows in minutes-from-midnight
  week: Window[][];
  holidays: Set<string>; // "YYYY-MM-DD" in calendar-local time
};

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 24 || min < 0 || min > 59) return null;
  const total = h * 60 + min;
  return total > 1440 ? null : total; // allow 24:00 as end-of-day
}

/** Parse & normalize the weeklyHours JSON into per-weekday sorted windows. */
function parseWeek(weeklyHours: string | Record<string, unknown>): Window[][] {
  const week: Window[][] = [[], [], [], [], [], [], []];
  let raw: Record<string, unknown> = {};
  try {
    raw = typeof weeklyHours === "string" ? JSON.parse(weeklyHours || "{}") : weeklyHours ?? {};
  } catch {
    raw = {};
  }
  WEEKDAY_KEYS.forEach((key, dow) => {
    const entry = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(entry)) return;
    const windows: Window[] = [];
    for (const pair of entry) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const open = parseHHMM(String(pair[0]));
      const close = parseHHMM(String(pair[1]));
      if (open == null || close == null || close <= open) continue;
      windows.push([open, close]);
    }
    // Sort by start, then merge overlaps so elapsed math can't double-count.
    windows.sort((a, b) => a[0] - b[0]);
    const merged: Window[] = [];
    for (const w of windows) {
      const last = merged[merged.length - 1];
      if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
      else merged.push([w[0], w[1]]);
    }
    week[dow] = merged;
  });
  return week;
}

// --- Timezone helpers -------------------------------------------------------
// We avoid a heavyweight tz library by using Intl to read the calendar-local
// wall-clock parts of an instant, and to compute the tz offset at an instant so
// we can convert a local Y-M-D H:M back to a UTC instant.

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; dow: number };

const partsCache = new Map<string, Intl.DateTimeFormat>();
function fmt(timezone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timezone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        weekday: "short",
      });
    } catch {
      // Bad tz → fall back to UTC so we never throw on malformed data.
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        weekday: "short",
      });
    }
    partsCache.set(timezone, f);
  }
  return f;
}

const DOW_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall-clock parts of `instant` as seen in `timezone`. */
function localParts(instant: Date, timezone: string): LocalParts {
  const parts = fmt(timezone).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    dow: DOW_INDEX[get("weekday")] ?? 0,
  };
}

/** The tz offset (ms to ADD to UTC to get local) at `instant` for `timezone`. */
function tzOffsetMs(instant: Date, timezone: string): number {
  const p = localParts(instant, timezone);
  // Interpret the local parts as if they were UTC, then diff against the instant.
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  // Round the source instant to the minute to match the parts' resolution.
  const instMin = Math.floor(instant.getTime() / MINUTE_MS) * MINUTE_MS;
  return asUtc - instMin;
}

/** Convert a calendar-local Y/M/D H:M to a UTC instant (ms). */
function localToUtcMs(
  timezone: string,
  year: number,
  month: number, // 1-12
  day: number,
  minutesFromMidnight: number,
): number {
  const hour = Math.floor(minutesFromMidnight / 60);
  const minute = minutesFromMidnight % 60;
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute);
  // Offset can differ slightly across DST boundaries; two passes converge.
  const off1 = tzOffsetMs(new Date(guessUtc), timezone);
  const candidate = guessUtc - off1;
  const off2 = tzOffsetMs(new Date(candidate), timezone);
  return guessUtc - off2;
}

function ymdKey(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

function parseCalendar(cal: BusinessCalendarLike): ParsedCalendar {
  const timezone = cal.timezone || "UTC";
  const holidays = new Set<string>();
  for (const h of cal.holidays ?? []) {
    const d = h.date instanceof Date ? h.date : new Date(h.date);
    if (isNaN(d.getTime())) continue;
    // A holiday is a whole calendar day, stored as UTC midnight of that day: read it as such, so a calendar
    // west of UTC does not move it to the day before. Any other instant is read in the calendar's timezone.
    if (d.getTime() % DAY_MS === 0) {
      holidays.add(ymdKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
      continue;
    }
    const p = localParts(d, timezone);
    holidays.add(ymdKey(p.year, p.month, p.day));
  }
  return { timezone, week: parseWeek(cal.weeklyHours), holidays };
}

/** Total open minutes on a given local calendar day (0 on holidays). */
function dayWindows(cal: ParsedCalendar, year: number, month: number, day: number, dow: number): Window[] {
  if (cal.holidays.has(ymdKey(year, month, day))) return [];
  return cal.week[dow] ?? [];
}

/**
 * Whether `weeklyHours` describes a 24/7 schedule (every weekday fully open and
 * no holidays). In that degenerate case business time == wall-clock time and
 * callers can skip the calendar entirely.
 */
export function isAlwaysOpen(cal: BusinessCalendarLike): boolean {
  const parsed = parseCalendar(cal);
  if (parsed.holidays.size > 0) return false;
  return parsed.week.every((wins) => wins.length === 1 && wins[0][0] === 0 && wins[0][1] >= 1440);
}

/**
 * Elapsed BUSINESS milliseconds between `start` and `end` (clamped to >= 0)
 * for the given calendar. Wall-clock time outside open windows / on holidays
 * does not count.
 *
 * Implementation: walk local calendar days from `start` to `end`, summing the
 * overlap of each day's open windows with the [start, end] interval.
 */
export function elapsedBusinessMs(start: Date, end: Date, cal: BusinessCalendarLike): number {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!(endMs > startMs)) return 0;

  const parsed = parseCalendar(cal);
  let total = 0;

  // Iterate local days. Anchor on the local date of `start`, step one local day
  // at a time until we pass `end`. We recompute the local date each step so DST
  // shifts stay correct.
  let cursorLocal = localParts(start, parsed.timezone);
  // Safety bound: at most the wall-clock span in days + 2.
  const maxDays = Math.ceil((endMs - startMs) / DAY_MS) + 3;

  for (let i = 0; i < maxDays; i++) {
    const { year, month, day, dow } = cursorLocal;
    const windows = dayWindows(parsed, year, month, day, dow);
    for (const [openMin, closeMin] of windows) {
      const winStart = localToUtcMs(parsed.timezone, year, month, day, openMin);
      const winEnd = localToUtcMs(parsed.timezone, year, month, day, closeMin);
      const lo = Math.max(winStart, startMs);
      const hi = Math.min(winEnd, endMs);
      if (hi > lo) total += hi - lo;
    }
    // Advance to the next local calendar day (noon avoids DST edge ambiguity).
    const nextDayNoonUtc = localToUtcMs(parsed.timezone, year, month, day, 12 * 60) + DAY_MS;
    if (nextDayNoonUtc > endMs + DAY_MS) break; // fully past the interval
    cursorLocal = localParts(new Date(nextDayNoonUtc), parsed.timezone);
    // Stop once the day's start is beyond `end`.
    const dayStartUtc = localToUtcMs(parsed.timezone, cursorLocal.year, cursorLocal.month, cursorLocal.day, 0);
    if (dayStartUtc >= endMs) break;
  }

  return total;
}

/**
 * Add `durationMs` of BUSINESS time to `start` and return the resulting instant
 * (the SLA deadline). Consumes open-window time day by day until the budget is
 * exhausted. If the calendar has no open time at all, returns `start` unchanged
 * (a degenerate calendar shouldn't produce an infinite deadline).
 */
export function addBusinessMs(start: Date, durationMs: number, cal: BusinessCalendarLike): Date {
  if (durationMs <= 0) return new Date(start.getTime());
  const parsed = parseCalendar(cal);
  let remaining = durationMs;
  const startMs = start.getTime();

  let cursorLocal = localParts(start, parsed.timezone);
  // Bound the walk: a year of local days is far beyond any sane SLA window and
  // guarantees termination on a pathologically sparse calendar.
  for (let i = 0; i < 366 * 3; i++) {
    const { year, month, day, dow } = cursorLocal;
    const windows = dayWindows(parsed, year, month, day, dow);
    for (const [openMin, closeMin] of windows) {
      const winStart = localToUtcMs(parsed.timezone, year, month, day, openMin);
      const winEnd = localToUtcMs(parsed.timezone, year, month, day, closeMin);
      // Only the portion of the window at/after `start` counts.
      const effStart = Math.max(winStart, startMs);
      if (winEnd <= effStart) continue;
      const avail = winEnd - effStart;
      if (avail >= remaining) return new Date(effStart + remaining);
      remaining -= avail;
    }
    const nextDayNoonUtc = localToUtcMs(parsed.timezone, year, month, day, 12 * 60) + DAY_MS;
    cursorLocal = localParts(new Date(nextDayNoonUtc), parsed.timezone);
  }
  // Budget never exhausted (empty/near-empty calendar): fail safe to `start`.
  return new Date(startMs);
}

/**
 * Default weekly schedule (Mon–Fri 09:00–17:00) as the JSON string stored in
 * BusinessCalendar.weeklyHours. Handy for seeding a new calendar.
 */
export function defaultWeeklyHoursJson(): string {
  const nine17 = [["09:00", "17:00"]];
  return JSON.stringify({ sun: [], mon: nine17, tue: nine17, wed: nine17, thu: nine17, fri: nine17, sat: [] });
}
