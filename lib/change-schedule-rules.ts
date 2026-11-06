/**
 * Pure scheduling rules for changes: window overlap, conflicts between changes, freeze-window
 * hits (with the emergency exception) and calendar date arithmetic. No DB access: the server
 * loaders in lib/change-schedule.ts feed these functions.
 */

import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  format,
  isValid,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";

// ── Windows ──────────────────────────────────────────────────────────────────

export type TimeWindow = { start: Date; end: Date };

/** Half-open overlap: windows that merely touch (one ends when the other starts) do not overlap. */
export function windowsOverlap(a: TimeWindow, b: TimeWindow): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

// ── Schedule entries ─────────────────────────────────────────────────────────

/** A change with a planned window, plus the CIs and services it touches. */
export type ScheduledChange = {
  id: number;
  title: string;
  status: string;
  type: string;
  risk: string;
  groupId: string | null;
  plannedStart: Date;
  plannedEnd: Date;
  /** Affected CIs (ChangeAsset). */
  assetIds: string[];
  /** Services those CIs belong to (ServiceAsset). */
  serviceIds: string[];
};

/** Statuses that no longer compete for a maintenance slot. */
const SETTLED_STATUSES: readonly string[] = ["CANCELLED", "REJECTED", "FAILED", "CLOSED"];

/** The calendar shows every change that was not cancelled. */
export function isOnCalendar(status: string): boolean {
  return status !== "CANCELLED";
}

/** Only changes that may still run take part in conflicts and freeze checks. */
export function isSchedulable(status: string): boolean {
  return !SETTLED_STATUSES.includes(status);
}

export const scheduledWindow = (change: ScheduledChange): TimeWindow => ({
  start: change.plannedStart,
  end: change.plannedEnd,
});

// ── Conflicts ────────────────────────────────────────────────────────────────

export type ScheduleConflict = {
  /** Ids of the two changes, `first` < `second`. */
  first: number;
  second: number;
  sharedAssetIds: string[];
  /** Services shared through different CIs; only filled when same-service detection is on. */
  sharedServiceIds: string[];
};

const intersection = (a: string[], b: string[]): string[] => {
  const bSet = new Set(b);
  return a.filter((x) => bSet.has(x));
};

function conflictBetween(a: ScheduledChange, b: ScheduledChange, sameService: boolean): ScheduleConflict | null {
  const sharedAssetIds = intersection(a.assetIds, b.assetIds);
  const sharedServiceIds = sameService ? intersection(a.serviceIds, b.serviceIds) : [];
  if (sharedAssetIds.length === 0 && sharedServiceIds.length === 0) return null;
  const [first, second] = a.id < b.id ? [a, b] : [b, a];
  return { first: first.id, second: second.id, sharedAssetIds, sharedServiceIds };
}

/**
 * Every pair of schedulable changes that overlap in time and share a CI (or, with
 * `sameService`, a service). Conflicts are warnings for the planner, never blocks.
 */
export function findConflicts(changes: ScheduledChange[], options: { sameService: boolean }): ScheduleConflict[] {
  const sorted = changes.filter((c) => isSchedulable(c.status)).sort((a, b) => a.plannedStart.getTime() - b.plannedStart.getTime());
  const conflicts: ScheduleConflict[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      // Sorted by start: once one starts after `current` ends, so do all that follow.
      if (sorted[j].plannedStart.getTime() >= sorted[i].plannedEnd.getTime()) break;
      const conflict = conflictBetween(sorted[i], sorted[j], options.sameService);
      if (conflict) conflicts.push(conflict);
    }
  }
  return conflicts;
}

/** The conflicts a single change is part of. */
export function conflictsOf(changeId: number, conflicts: ScheduleConflict[]): ScheduleConflict[] {
  return conflicts.filter((c) => c.first === changeId || c.second === changeId);
}

export const otherChangeId = (changeId: number, conflict: ScheduleConflict): number =>
  conflict.first === changeId ? conflict.second : conflict.first;

// ── Freeze windows ───────────────────────────────────────────────────────────

export type FreezeWindow = {
  id: string;
  name: string;
  reason: string | null;
  startsAt: Date;
  endsAt: Date;
  serviceId: string | null;
  groupId: string | null;
};

/** What a freeze window needs to know about a change to decide whether it binds it. */
export type FreezeSubject = { groupId: string | null; serviceIds: string[] };

/** Global when unscoped; otherwise every scope that is set must match the change. */
export function freezeAppliesTo(freeze: FreezeWindow, subject: FreezeSubject): boolean {
  const serviceMatches = freeze.serviceId === null || subject.serviceIds.includes(freeze.serviceId);
  const groupMatches = freeze.groupId === null || freeze.groupId === subject.groupId;
  return serviceMatches && groupMatches;
}

export function freezeHits(window: TimeWindow, subject: FreezeSubject, freezes: FreezeWindow[]): FreezeWindow[] {
  return freezes.filter((f) => windowsOverlap(window, { start: f.startsAt, end: f.endsAt }) && freezeAppliesTo(f, subject));
}

export type FreezeState = "active" | "upcoming" | "past";

export function freezeState(freeze: Pick<FreezeWindow, "startsAt" | "endsAt">, now: Date): FreezeState {
  if (freeze.endsAt.getTime() <= now.getTime()) return "past";
  return freeze.startsAt.getTime() > now.getTime() ? "upcoming" : "active";
}

export const freezeWindowError = (start: Date, end: Date): string | null =>
  end.getTime() > start.getTime() ? null : "A freeze window must end after it starts.";

const FREEZE_DATE = "PP p";

export function describeFreeze(freeze: FreezeWindow): string {
  return `${freeze.name} (${format(freeze.startsAt, FREEZE_DATE)} – ${format(freeze.endsAt, FREEZE_DATE)})`;
}

const describeFreezes = (hits: FreezeWindow[]): string => hits.map(describeFreeze).join("; ");

export const FREEZE_JUSTIFICATION_REQUIRED =
  "This emergency change falls inside a freeze window. Add a justification for overriding it.";

export type FreezeVerdict =
  | { ok: true; overrideComment: string | null }
  | { ok: false; error: string; needsJustification: boolean };

/**
 * May a change with this window go ahead? No hit: yes. A hit refuses the change unless it is an
 * EMERGENCY, which may override the freeze but must justify it; the justification is recorded
 * as `overrideComment`.
 */
export function freezeVerdict(input: { type: string; hits: FreezeWindow[]; justification: string | null }): FreezeVerdict {
  const { type, hits, justification } = input;
  if (hits.length === 0) return { ok: true, overrideComment: null };
  if (type !== "EMERGENCY") {
    return {
      ok: false,
      needsJustification: false,
      error: `The planned window falls inside a change freeze: ${describeFreezes(hits)}. Choose a window outside it, or raise an emergency change.`,
    };
  }
  const reason = justification?.trim();
  if (!reason) return { ok: false, needsJustification: true, error: FREEZE_JUSTIFICATION_REQUIRED };
  return { ok: true, overrideComment: `Emergency override of change freeze ${describeFreezes(hits)}: ${reason}` };
}

// ── Calendar ─────────────────────────────────────────────────────────────────

export const CALENDAR_VIEWS = ["month", "week"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const DEFAULT_CALENDAR_VIEW: CalendarView = "month";
const WEEK_OPTIONS = { weekStartsOn: 1 } as const;
export const ANCHOR_FORMAT = "yyyy-MM-dd";

export const parseCalendarView = (value: string | undefined): CalendarView =>
  CALENDAR_VIEWS.find((v) => v === value) ?? DEFAULT_CALENDAR_VIEW;

/** The day a calendar page is centred on; falls back to `today` for a missing or malformed param. */
export function parseAnchor(value: string | undefined, today: Date): Date {
  const parsed = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : null;
  return startOfDay(parsed && isValid(parsed) ? parsed : today);
}

/** The visible span of the calendar: whole weeks, Monday first. `end` is exclusive. */
export function visibleRange(view: CalendarView, anchor: Date): TimeWindow {
  if (view === "week") {
    const start = startOfWeek(anchor, WEEK_OPTIONS);
    return { start, end: addWeeks(start, 1) };
  }
  return {
    start: startOfWeek(startOfMonth(anchor), WEEK_OPTIONS),
    end: addWeeks(startOfWeek(endOfMonth(anchor), WEEK_OPTIONS), 1),
  };
}

/** The first day of each day-cell in the range. */
export function daysInRange(range: TimeWindow): Date[] {
  const days: Date[] = [];
  for (let day = startOfDay(range.start); day.getTime() < range.end.getTime(); day = addDays(day, 1)) days.push(day);
  return days;
}

export const dayWindow = (day: Date): TimeWindow => ({ start: startOfDay(day), end: addDays(startOfDay(day), 1) });

export function shiftAnchor(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  return view === "week" ? addWeeks(anchor, direction) : addMonths(anchor, direction);
}

export const formatAnchor = (anchor: Date): string => format(anchor, ANCHOR_FORMAT);

// ── Calendar filters ─────────────────────────────────────────────────────────

export type ScheduleFilter = { groupId?: string; risk?: string; status?: string };

/** `all` or an absent value means "no restriction". */
const matches = (filter: string | undefined, value: string | null): boolean =>
  !filter || filter === "all" || filter === value;

export function matchesFilter(change: ScheduledChange, filter: ScheduleFilter): boolean {
  return matches(filter.groupId, change.groupId) && matches(filter.risk, change.risk) && matches(filter.status, change.status);
}
