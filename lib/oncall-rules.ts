import { ONCALL_ROTATION_META, type OnCallRotationType } from "@/lib/constants";

// Pure on-call resolver: who is on call for a schedule at an instant. No DB, no
// clock — callers pass `at`. Overrides always win over the rotation.

const HOUR_MS = 3_600_000;

export const MIN_CUSTOM_INTERVAL_HOURS = 1;
export const MAX_CUSTOM_INTERVAL_HOURS = 24 * 30;

export type RotationConfig = {
  rotationType: string;
  customIntervalHours: number | null;
  /** "HH:mm" wall-clock handoff time in `timezone`. */
  handoffTime: string;
  /** IANA zone. An unknown zone is treated as UTC. */
  timezone: string;
  /** First handoff instant: the member at position 0 starts here. Before it nobody is on call. */
  rotationStart: Date;
  /** User ids in rotation order (position 0 first). */
  memberIds: readonly string[];
};

export type OverrideWindow = {
  id: string;
  userId: string;
  replacesUserId: string | null;
  startsAt: Date;
  endsAt: Date;
};

export type ScheduleInput = RotationConfig & { overrides: readonly OverrideWindow[] };

export type OnCallSlot = {
  userId: string;
  source: "ROTATION" | "OVERRIDE";
  overrideId: string | null;
};

/** A stretch of time with one holder; `userId` null = a gap (nobody on call). */
export type TimelineSegment = {
  userId: string | null;
  source: OnCallSlot["source"] | null;
  overrideId: string | null;
  start: Date;
  end: Date;
};

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const safeZone = (timezone: string) => (isValidTimeZone(timezone) ? timezone : "UTC");

type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

function wallClockAt(instant: Date, timezone: string): WallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute") };
}

/** Offset of `timezone` from UTC at `instant`, in ms (local = utc + offset). */
function zoneOffsetMs(instant: Date, timezone: string): number {
  const w = wallClockAt(instant, timezone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

/** The UTC instant at which the wall clock in `timezone` reads the given date and time. */
export function zonedWallToUtc(
  date: { year: number; month: number; day: number },
  time: string,
  timezone: string,
): Date {
  const zone = safeZone(timezone);
  const [hour, minute] = parseHandoffTime(time);
  const naive = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  const first = naive - zoneOffsetMs(new Date(naive), zone);
  // Re-check at the candidate: a DST change between the guess and the result shifts the offset.
  const second = naive - zoneOffsetMs(new Date(first), zone);
  return new Date(second);
}

function parseHandoffTime(time: string): [number, number] {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

export function isValidHandoffTime(time: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
}

/** The local calendar date of `instant` in `timezone`. */
export function localDate(instant: Date, timezone: string): { year: number; month: number; day: number } {
  const { year, month, day } = wallClockAt(instant, safeZone(timezone));
  return { year, month, day };
}

/** The calendar date of `instant` in `timezone`, as "YYYY-MM-DD". */
export function calendarDateIn(instant: Date, timezone: string): string {
  const { year, month, day } = localDate(instant, timezone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

/** Shift length in hours, or null when the config does not define a usable one. */
export function shiftHours(cfg: Pick<RotationConfig, "rotationType" | "customIntervalHours">): number | null {
  const meta = ONCALL_ROTATION_META[cfg.rotationType as OnCallRotationType];
  const hours = meta ? (meta.hours ?? cfg.customIntervalHours) : null;
  return hours != null && Number.isFinite(hours) && hours >= MIN_CUSTOM_INTERVAL_HOURS ? hours : null;
}

/** Start of shift `index`. Daily/weekly shifts hand off at the same local wall time across DST. */
function shiftStart(cfg: RotationConfig, hours: number, index: number): Date {
  if (index === 0) return cfg.rotationStart;
  if (cfg.rotationType === "CUSTOM") {
    return new Date(cfg.rotationStart.getTime() + index * hours * HOUR_MS);
  }
  const calendarDays = hours / 24;
  const anchor = localDate(cfg.rotationStart, cfg.timezone);
  const day = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day + index * calendarDays));
  return zonedWallToUtc(
    { year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate() },
    cfg.handoffTime,
    cfg.timezone,
  );
}

function shiftIndexAt(cfg: RotationConfig, hours: number, at: Date): number | null {
  if (at.getTime() < cfg.rotationStart.getTime()) return null;
  let index = Math.floor((at.getTime() - cfg.rotationStart.getTime()) / (hours * HOUR_MS));
  // The estimate ignores DST-shifted handoffs; settle on the shift that really contains `at`.
  while (shiftStart(cfg, hours, index + 1).getTime() <= at.getTime()) index++;
  while (index > 0 && shiftStart(cfg, hours, index).getTime() > at.getTime()) index--;
  return index;
}

/** The rotation member on call at `at`, ignoring overrides; null before the start, with no members or no usable interval. */
export function rotationHolderAt(cfg: RotationConfig, at: Date): string | null {
  const hours = shiftHours(cfg);
  if (hours == null || cfg.memberIds.length === 0) return null;
  const index = shiftIndexAt(cfg, hours, at);
  return index == null ? null : cfg.memberIds[index % cfg.memberIds.length];
}

/** The override covering `at` (half-open window); the one starting latest wins when several overlap. */
function overrideAt(overrides: readonly OverrideWindow[], at: Date): OverrideWindow | null {
  const t = at.getTime();
  let winner: OverrideWindow | null = null;
  for (const o of overrides) {
    if (o.startsAt.getTime() <= t && t < o.endsAt.getTime() && (!winner || o.startsAt > winner.startsAt)) {
      winner = o;
    }
  }
  return winner;
}

/** Who is on call for the schedule at `at`: an override if one covers it, else the rotation, else nobody. */
export function onCallAt(schedule: ScheduleInput, at: Date): OnCallSlot | null {
  const override = overrideAt(schedule.overrides, at);
  if (override) return { userId: override.userId, source: "OVERRIDE", overrideId: override.id };
  const holder = rotationHolderAt(schedule, at);
  return holder ? { userId: holder, source: "ROTATION", overrideId: null } : null;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** Handoff instants strictly inside (from, to). */
function rotationBoundaries(cfg: RotationConfig, from: Date, to: Date): number[] {
  const hours = shiftHours(cfg);
  if (hours == null || cfg.memberIds.length === 0) return [];
  const boundaries: number[] = [];
  for (let index = shiftIndexAt(cfg, hours, from) ?? 0; ; index++) {
    const start = shiftStart(cfg, hours, index).getTime();
    if (start >= to.getTime()) return boundaries;
    if (start > from.getTime()) boundaries.push(start);
  }
}

/** Who is on call over [from, to): consecutive stretches with one holder, gaps included as `userId: null`. */
export function buildTimeline(schedule: ScheduleInput, from: Date, to: Date): TimelineSegment[] {
  if (to.getTime() <= from.getTime()) return [];
  const overrideEdges = schedule.overrides.flatMap((o) => [o.startsAt.getTime(), o.endsAt.getTime()]);
  const edges = [...rotationBoundaries(schedule, from, to), ...overrideEdges].filter(
    (t) => t > from.getTime() && t < to.getTime(),
  );
  const cuts = [...new Set([from.getTime(), ...edges, to.getTime()])].sort((a, b) => a - b);

  const segments: TimelineSegment[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = new Date(cuts[i]);
    const slot = onCallAt(schedule, start);
    const segment: TimelineSegment = {
      userId: slot?.userId ?? null,
      source: slot?.source ?? null,
      overrideId: slot?.overrideId ?? null,
      start,
      end: new Date(cuts[i + 1]),
    };
    const previous = segments.at(-1);
    if (previous && previous.userId === segment.userId && previous.overrideId === segment.overrideId) {
      previous.end = segment.end;
    } else {
      segments.push(segment);
    }
  }
  return segments;
}

/** The stretches of a timeline with nobody on call. */
export function findGaps(timeline: readonly TimelineSegment[]): TimelineSegment[] {
  return timeline.filter((s) => s.userId === null);
}

// ---------------------------------------------------------------------------
// Escalation helpers
// ---------------------------------------------------------------------------

/** Escalation step actions whose target is whoever is on call for the ticket's group. */
const ONCALL_ESCALATION_ACTIONS: readonly string[] = ["NOTIFY_ONCALL", "REASSIGN_ONCALL"];

export const isOnCallEscalationAction = (action: string): boolean => ONCALL_ESCALATION_ACTIONS.includes(action);

/**
 * Who a ticket should be reassigned to when several people are on call: keep the
 * current assignee when they are among them, else the first on-call user.
 * Null when nobody is on call.
 */
export function pickOnCallAssignee(onCallUserIds: readonly string[], currentAssigneeId: string | null): string | null {
  if (onCallUserIds.length === 0) return null;
  return currentAssigneeId && onCallUserIds.includes(currentAssigneeId) ? currentAssigneeId : onCallUserIds[0];
}

// ---------------------------------------------------------------------------
// Override rules
// ---------------------------------------------------------------------------

export const MAX_OVERRIDE_DAYS = 90;
export const MAX_OVERRIDE_LEAD_DAYS = 365;

/** Why an override window is not acceptable, or null when it is. */
export function overrideWindowError(startsAt: Date, endsAt: Date, now: Date): string | null {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return "Enter a valid start and end.";
  if (endsAt <= startsAt) return "The end must be after the start.";
  if (endsAt <= now) return "The override is already over.";
  if (endsAt.getTime() - startsAt.getTime() > MAX_OVERRIDE_DAYS * 24 * HOUR_MS) {
    return `An override can cover at most ${MAX_OVERRIDE_DAYS} days.`;
  }
  if (startsAt.getTime() - now.getTime() > MAX_OVERRIDE_LEAD_DAYS * 24 * HOUR_MS) {
    return `An override can start at most ${MAX_OVERRIDE_LEAD_DAYS} days ahead.`;
  }
  return null;
}

/** Whether the rotation (ignoring overrides) has `userId` on call for the whole of [startsAt, endsAt). */
export function isWithinOwnShift(rotation: RotationConfig, userId: string, startsAt: Date, endsAt: Date): boolean {
  const timeline = buildTimeline({ ...rotation, overrides: [] }, startsAt, endsAt);
  return timeline.length > 0 && timeline.every((segment) => segment.userId === userId);
}

/**
 * Managers may set any override. Anyone else may only hand their own rotation
 * shift to a colleague: they must be a rotation member, name themselves as the
 * replaced person, cannot make themselves the cover, and the window must lie
 * entirely within their own rotation shift(s).
 */
export function canCreateOverride(
  actor: { id: string; isManager: boolean },
  override: { userId: string; replacesUserId: string | null; startsAt: Date; endsAt: Date },
  rotation: RotationConfig,
): boolean {
  if (actor.isManager) return true;
  return (
    override.replacesUserId === actor.id &&
    override.userId !== actor.id &&
    rotation.memberIds.includes(actor.id) &&
    isWithinOwnShift(rotation, actor.id, override.startsAt, override.endsAt)
  );
}

/**
 * Managers may remove any override; anyone else only the swap they started by
 * handing their own shift over (a cover cannot drop duty a manager assigned).
 */
export function canRemoveOverride(
  actor: { id: string; isManager: boolean },
  override: { replacesUserId: string | null },
): boolean {
  return actor.isManager || override.replacesUserId === actor.id;
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/;

/** A "YYYY-MM-DD" calendar date, or null when malformed or not a real day. */
export function parseCalendarDate(text: string): { year: number; month: number; day: number } | null {
  const match = DATE_ONLY.exec(text);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  const real = probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
  return real ? { year, month, day } : null;
}

/**
 * A date-time typed by a person. "YYYY-MM-DD HH:mm" (or with "T") is wall-clock
 * time in `timezone`; anything else must be a full ISO timestamp with an offset.
 * Invalid input yields an Invalid Date.
 */
export function parseZonedDateTime(text: string, timezone: string): Date {
  const trimmed = text.trim();
  const local = LOCAL_DATE_TIME.exec(trimmed);
  if (!local) return new Date(trimmed);
  const date = parseCalendarDate(local[1]);
  return date && isValidHandoffTime(local[2]) ? zonedWallToUtc(date, local[2], timezone) : new Date(Number.NaN);
}
