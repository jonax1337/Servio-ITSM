import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { onCallAt, type OnCallSlot, type ScheduleInput } from "@/lib/oncall-rules";

/** A person on call for a team at a given instant. */
export type OnCallUser = { userId: string; name: string | null; email: string };

export type OnCallPerson = { id: string; name: string | null; email: string; isActive: boolean };

export type LoadedOverride = {
  id: string;
  user: OnCallPerson;
  replaces: OnCallPerson | null;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
};

export type LoadedSchedule = {
  id: string;
  name: string;
  description: string | null;
  group: { id: string; name: string; color: string };
  timezone: string;
  rotationType: string;
  customIntervalHours: number | null;
  handoffTime: string;
  rotationStart: Date;
  isActive: boolean;
  /** Rotation members in shift order. */
  members: OnCallPerson[];
  /** Overrides overlapping the loaded window, earliest first. */
  overrides: LoadedOverride[];
};

const PERSON = { id: true, name: true, email: true, isActive: true } as const;

/**
 * Schedules matching `where`, with the overrides that overlap [from, until).
 * Ordered by group, then name.
 */
export async function loadSchedules(
  where: Prisma.OnCallScheduleWhereInput,
  from: Date,
  until: Date,
): Promise<LoadedSchedule[]> {
  const rows = await db.onCallSchedule.findMany({
    where,
    orderBy: [{ group: { name: "asc" } }, { name: "asc" }],
    include: {
      group: { select: { id: true, name: true, color: true } },
      members: { orderBy: { position: "asc" }, select: { user: { select: PERSON } } },
      overrides: {
        where: { endsAt: { gt: from }, startsAt: { lt: until } },
        orderBy: { startsAt: "asc" },
        include: { user: { select: PERSON }, replaces: { select: PERSON } },
      },
    },
  });
  return rows.map(({ members, overrides, ...schedule }) => ({
    ...schedule,
    members: members.map((m) => m.user),
    overrides: overrides.map((o) => ({
      id: o.id,
      user: o.user,
      replaces: o.replaces,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      reason: o.reason,
    })),
  }));
}

/** The input shape the pure resolver works on. */
export function toScheduleInput(schedule: LoadedSchedule): ScheduleInput {
  return {
    rotationType: schedule.rotationType,
    customIntervalHours: schedule.customIntervalHours,
    handoffTime: schedule.handoffTime,
    timezone: schedule.timezone,
    rotationStart: schedule.rotationStart,
    memberIds: schedule.members.map((m) => m.id),
    overrides: schedule.overrides.map((o) => ({
      id: o.id,
      userId: o.user.id,
      replacesUserId: o.replaces?.id ?? null,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
    })),
  };
}

/** Who holds `slot` in `schedule` (the override's user, else the rotation member). */
export function slotPerson(schedule: LoadedSchedule, slot: OnCallSlot): OnCallPerson | null {
  const override = slot.overrideId ? schedule.overrides.find((o) => o.id === slot.overrideId) : null;
  return override?.user ?? schedule.members.find((m) => m.id === slot.userId) ?? null;
}

/** The person on call for a loaded schedule at `at`, or null (gap). */
export function onCallPersonAt(schedule: LoadedSchedule, at: Date): OnCallPerson | null {
  const slot = onCallAt(toScheduleInput(schedule), at);
  return slot ? slotPerson(schedule, slot) : null;
}

/**
 * Who is on call for the team `groupId` at `at` (default: now), across that
 * team's active OnCallSchedules — overrides win over the rotation. Deactivated
 * users are skipped and a person on several schedules appears once. Empty when
 * nobody is on call; callers must fall back gracefully.
 */
export async function currentOnCall(groupId: string, at: Date = new Date()): Promise<OnCallUser[]> {
  const schedules = await loadSchedules({ groupId, isActive: true }, at, new Date(at.getTime() + 1));
  const seen = new Set<string>();
  const onCall: OnCallUser[] = [];
  for (const schedule of schedules) {
    const person = onCallPersonAt(schedule, at);
    if (!person?.isActive || seen.has(person.id)) continue;
    seen.add(person.id);
    onCall.push({ userId: person.id, name: person.name, email: person.email });
  }
  return onCall;
}
