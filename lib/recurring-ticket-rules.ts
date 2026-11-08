/**
 * Recurrence math of recurring tickets (GLPI "recurrent items"). Pure: no DB,
 * no clock — callers pass `now`. Used by the scheduler tick
 * (lib/ticks/recurring-tickets.ts), the console actions and the REST API.
 *
 * Occurrence n is due at `firstDueAt` + n × `interval` `frequency` units, on the
 * same wall-clock time in `timezone`. Every occurrence is computed from the
 * anchor (never by stepping from the previous one), so month ends clamp without
 * drifting: Jan 31 → Feb 28 (29 in a leap year) → Mar 31 → Apr 30. A due time
 * that does not exist on a DST spring-forward day moves forward by the gap.
 *
 * The ticket for an occurrence is created `createBeforeDays` local calendar days
 * before it is due (same wall-clock time). The lead time may be longer than one
 * recurrence step (a weekly check created a month ahead): several upcoming
 * occurrences are then open at once and each gets its own ticket, oldest first.
 * It is capped so that at most MAX_OPEN_OCCURRENCES are open at a time.
 */
import { RECURRENCE_FREQUENCY_META, type RecurrenceFrequency } from "@/lib/constants";
import { isValidTimeZone } from "@/lib/oncall-rules";

export const MAX_RECURRENCE_INTERVAL = 365;
export const MAX_CREATE_BEFORE_DAYS = 365;
/** Upcoming occurrences whose ticket may exist at the same time (bounds the lead time of short steps). */
export const MAX_OPEN_OCCURRENCES = 31;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type Recurrence = {
  frequency: RecurrenceFrequency;
  /** Every N frequency units (>= 1). */
  interval: number;
  /** IANA zone the due time is expressed in; an unknown zone is treated as UTC. */
  timezone: string;
  /** Due instant of occurrence 0. */
  firstDueAt: Date;
  /** Lead time in days: the ticket is created this many days before it is due. */
  createBeforeDays: number;
};

type CalendarDate = { year: number; month: number; day: number };
type WallClock = CalendarDate & { hour: number; minute: number };

// Intl is slow, and a catch-up or a long simulation reads thousands of wall
// clocks: formatters are cached per zone, offsets per zone and 15-minute UTC
// slot (every real DST/offset change happens on such a boundary).
const formatters = new Map<string, Intl.DateTimeFormat>();
const offsets = new Map<string, number>();
const SLOT_MS = 15 * 60_000;
const MAX_CACHED_OFFSETS = 20_000;
function formatterFor(timezone: string): Intl.DateTimeFormat {
  const zone = isValidTimeZone(timezone) ? timezone : "UTC";
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
    formatters.set(zone, f);
  }
  return f;
}

/** Offset of `timezone` from UTC at `instant`, in ms (local = utc + offset). */
function zoneOffsetMs(instant: Date, timezone: string): number {
  const slot = Math.floor(instant.getTime() / SLOT_MS) * SLOT_MS;
  const key = `${timezone}|${slot}`;
  const cached = offsets.get(key);
  if (cached !== undefined) return cached;
  const parts = formatterFor(timezone).formatToParts(new Date(slot));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const offset = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute")) - slot;
  if (offsets.size >= MAX_CACHED_OFFSETS) offsets.clear();
  offsets.set(key, offset);
  return offset;
}

function wallClockAt(instant: Date, timezone: string): WallClock {
  const local = new Date(Math.floor(instant.getTime() / 60_000) * 60_000 + zoneOffsetMs(instant, timezone));
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}

/**
 * The UTC instant at which the wall clock in `timezone` reads `date` `hour:minute`
 * (same two-pass method as lib/oncall-rules.ts zonedWallToUtc). A time inside a
 * spring-forward gap resolves to the instant the gap ends plus its offset into it.
 */
function zonedWallToUtc(date: CalendarDate, hour: number, minute: number, timezone: string): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const first = naive - zoneOffsetMs(new Date(naive), timezone);
  return new Date(naive - zoneOffsetMs(new Date(first), timezone));
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (w: WallClock) => `${pad(w.hour)}:${pad(w.minute)}`;
const atWallTime = (date: CalendarDate, w: WallClock, timezone: string) => zonedWallToUtc(date, w.hour, w.minute, timezone);

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** `months` after the anchor's month, keeping its day of month clamped to the month's length. */
function addMonths(date: CalendarDate, months: number): CalendarDate {
  const index = date.month - 1 + months;
  const year = date.year + Math.floor(index / 12);
  const month = (((index % 12) + 12) % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** Due instant of occurrence `n` (0 = `firstDueAt`). */
export function occurrenceAt(rule: Recurrence, n: number): Date {
  if (n === 0) return new Date(rule.firstDueAt.getTime());
  const anchor = wallClockAt(rule.firstDueAt, rule.timezone);
  const steps = n * rule.interval;
  const date =
    rule.frequency === "DAILY" ? addDays(anchor, steps)
    : rule.frequency === "WEEKLY" ? addDays(anchor, steps * 7)
    : rule.frequency === "MONTHLY" ? addMonths(anchor, steps)
    : addMonths(anchor, steps * 12);
  return atWallTime(date, anchor, rule.timezone);
}

/** An upper bound of one step's length, so an index estimate never overshoots. */
function maxStepMs(rule: Recurrence): number {
  const days = { DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 }[rule.frequency];
  return rule.interval * days * DAY_MS + 2 * HOUR_MS;
}

/** The smallest index whose occurrence is due at or after `t` (0 when `t` is before the first one). */
export function indexOnOrAfter(rule: Recurrence, t: Date): number {
  const span = t.getTime() - rule.firstDueAt.getTime();
  if (span <= 0) return 0;
  let n = Math.max(0, Math.floor(span / maxStepMs(rule)) - 1);
  while (occurrenceAt(rule, n).getTime() < t.getTime()) n++;
  return n;
}

/** The first occurrence due at or after `t`. */
export function occurrenceOnOrAfter(rule: Recurrence, t: Date): Date {
  return occurrenceAt(rule, indexOnOrAfter(rule, t));
}

/** When the ticket for the occurrence due at `dueAt` is created: `createBeforeDays` local days earlier. */
export function creationTimeFor(rule: Recurrence, dueAt: Date): Date {
  if (rule.createBeforeDays <= 0) return new Date(dueAt.getTime());
  const due = wallClockAt(dueAt, rule.timezone);
  return atWallTime(addDays(due, -rule.createBeforeDays), due, rule.timezone);
}

/**
 * The next occurrence still to create when a schedule is saved, resumed or its
 * recurrence edited: the first one that is not yet due and comes after the last
 * one a ticket was created for. Occurrences that fell due while a schedule was
 * paused (or before it existed) are not created retroactively.
 */
export function initialNextDue(rule: Recurrence, now: Date, lastCreatedFor: Date | null): Date {
  const after = lastCreatedFor && lastCreatedFor.getTime() >= now.getTime() ? new Date(lastCreatedFor.getTime() + 1) : now;
  return occurrenceOnOrAfter(rule, after);
}

export type PlannedOccurrence = {
  /** Due instant of the occurrence to create a ticket for now. */
  dueAt: Date;
  /** The schedule's new `nextDueAt` once that ticket exists. */
  nextDueAt: Date;
  /** Older overdue occurrences skipped by the catch-up (downtime). */
  skipped: number;
};

/**
 * The occurrence to create a ticket for at `now`, or null when none is open yet.
 *
 * - The occurrence at `nextDueAt` is open once its creation time has passed.
 * - If it is not due yet, it is created as is.
 * - If the app was down and it is already overdue, only the LATEST overdue
 *   occurrence is created (catch-up once, no flood); older ones are skipped.
 *   A not-yet-due occurrence whose window is also open follows on the next call.
 *
 * `force` ("create now") ignores the creation window and creates the next
 * occurrence that is not due yet right away (overdue ones are skipped); the
 * schedule then moves on to the one after it.
 */
export function nextToCreate(
  rule: Recurrence,
  nextDueAt: Date,
  now: Date,
  opts: { force?: boolean } = {},
): PlannedOccurrence | null {
  const n = indexOnOrAfter(rule, nextDueAt);
  const due = occurrenceAt(rule, n);
  if (due.getTime() >= now.getTime()) {
    if (!opts.force && creationTimeFor(rule, due).getTime() > now.getTime()) return null;
    return { dueAt: due, nextDueAt: occurrenceAt(rule, n + 1), skipped: 0 };
  }
  const firstNotDue = indexOnOrAfter(rule, now);
  const pick = opts.force ? firstNotDue : firstNotDue - 1;
  return { dueAt: occurrenceAt(rule, pick), nextDueAt: occurrenceAt(rule, pick + 1), skipped: pick - n };
}

/** The shortest possible length of one recurrence step, in whole days. */
export function shortestStepDays(frequency: RecurrenceFrequency, interval: number): number {
  return interval * { DAILY: 1, WEEKLY: 7, MONTHLY: 28, YEARLY: 365 }[frequency];
}

/** The longest lead time a recurrence allows: MAX_CREATE_BEFORE_DAYS, or less where it would open more than MAX_OPEN_OCCURRENCES at once. */
export function maxLeadTimeDays(frequency: RecurrenceFrequency, interval: number): number {
  return Math.min(MAX_CREATE_BEFORE_DAYS, MAX_OPEN_OCCURRENCES * shortestStepDays(frequency, interval) - 1);
}

/** How many occurrences can have an open ticket at the same time with this lead time (1 = never more than one). */
export function openOccurrencesAtOnce(frequency: RecurrenceFrequency, interval: number, createBeforeDays: number): number {
  return Math.floor(Math.max(0, createBeforeDays) / shortestStepDays(frequency, interval)) + 1;
}

/** Why a lead time does not fit the recurrence, or null when it does. */
export function leadTimeError(frequency: RecurrenceFrequency, interval: number, createBeforeDays: number): string | null {
  const max = maxLeadTimeDays(frequency, interval);
  if (createBeforeDays <= max) return null;
  return `Create the ticket at most ${max} day${max === 1 ? "" : "s"} ahead for ${describeRecurrence(frequency, interval).toLowerCase()} (at most ${MAX_OPEN_OCCURRENCES} open at once).`;
}

/** "Every day", "Every 3 months". */
export function describeRecurrence(frequency: RecurrenceFrequency, interval: number): string {
  const unit = RECURRENCE_FREQUENCY_META[frequency]?.unit ?? "period";
  return interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
}

/** An instant as the local "YYYY-MM-DD" date and "HH:mm" time in `timezone` (form defaults, API patch merges). */
export function localDateTimeParts(instant: Date, timezone: string): { date: string; time: string } {
  const w = wallClockAt(instant, timezone);
  return { date: `${w.year}-${pad(w.month)}-${pad(w.day)}`, time: hhmm(w) };
}
