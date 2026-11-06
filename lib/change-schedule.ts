import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getBoolSetting } from "@/lib/settings";
import { isWindowEditable } from "@/lib/change-rules";
import {
  conflictsOf,
  findConflicts,
  freezeHits,
  freezeVerdict,
  isOnCalendar,
  otherChangeId,
  type FreezeWindow,
  type ScheduleConflict,
  type ScheduledChange,
  type TimeWindow,
} from "@/lib/change-schedule-rules";

/** DB-backed loaders for the change calendar, conflict check and freeze enforcement. */

const CALENDAR_CHANGE_LIMIT = 500;

/** Also flag changes that share a service through different CIs (default on). */
const SAME_SERVICE_SETTING = "CHANGE_CONFLICT_SAME_SERVICE";

const scheduledChangeSelect = {
  id: true,
  title: true,
  status: true,
  type: true,
  risk: true,
  groupId: true,
  plannedStart: true,
  plannedEnd: true,
  assets: { select: { assetId: true, asset: { select: { services: { select: { serviceId: true } } } } } },
} satisfies Prisma.ChangeSelect;

type ScheduledChangeRow = Prisma.ChangeGetPayload<{ select: typeof scheduledChangeSelect }>;

/** Changes that are on the calendar and whose planned window touches `range`. */
const inRangeWhere = (range: TimeWindow): Prisma.ChangeWhereInput => ({
  status: { not: "CANCELLED" },
  plannedStart: { lt: range.end },
  plannedEnd: { gt: range.start },
});

function toScheduledChange(row: ScheduledChangeRow): ScheduledChange | null {
  if (!row.plannedStart || !row.plannedEnd) return null;
  const serviceIds = new Set(row.assets.flatMap((a) => a.asset.services.map((s) => s.serviceId)));
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    type: row.type,
    risk: row.risk,
    groupId: row.groupId,
    plannedStart: row.plannedStart,
    plannedEnd: row.plannedEnd,
    assetIds: row.assets.map((a) => a.assetId),
    serviceIds: [...serviceIds],
  };
}

const compact = (changes: (ScheduledChange | null)[]): ScheduledChange[] =>
  changes.filter((c): c is ScheduledChange => c !== null && isOnCalendar(c.status));

/** A freeze window with the names of its scopes, for display. */
export type FreezeWindowRow = FreezeWindow & { serviceName: string | null; groupName: string | null };

async function loadFreezes(range: TimeWindow): Promise<FreezeWindowRow[]> {
  const rows = await db.changeFreezeWindow.findMany({
    where: { startsAt: { lt: range.end }, endsAt: { gt: range.start } },
    include: { service: { select: { name: true } }, group: { select: { name: true } } },
    orderBy: { startsAt: "asc" },
  });
  return rows.map(({ service, group, ...freeze }) => ({
    ...freeze,
    serviceName: service?.name ?? null,
    groupName: group?.name ?? null,
  }));
}

export type Schedule = {
  changes: ScheduledChange[];
  freezes: FreezeWindowRow[];
  conflicts: ScheduleConflict[];
};

/** Everything planned in `range`: changes, freeze windows and the conflicts among those changes. */
export async function loadSchedule(range: TimeWindow): Promise<Schedule> {
  const [rows, freezes, sameService] = await Promise.all([
    db.change.findMany({
      where: inRangeWhere(range),
      select: scheduledChangeSelect,
      orderBy: { plannedStart: "asc" },
      take: CALENDAR_CHANGE_LIMIT,
    }),
    loadFreezes(range),
    getBoolSetting(SAME_SERVICE_SETTING, true),
  ]);
  const changes = compact(rows.map(toScheduledChange));
  return { changes, freezes, conflicts: findConflicts(changes, { sameService }) };
}

async function serviceIdsOfAssets(assetIds: string[]): Promise<string[]> {
  if (assetIds.length === 0) return [];
  const rows = await db.serviceAsset.findMany({ where: { assetId: { in: assetIds } }, select: { serviceId: true } });
  return [...new Set(rows.map((r) => r.serviceId))];
}

/** The freeze windows that forbid `window` for a change owned by `groupId` and touching `assetIds`. */
export async function freezeHitsForWindow(
  window: TimeWindow,
  subject: { groupId: string | null; assetIds: string[] },
): Promise<FreezeWindowRow[]> {
  const [freezes, serviceIds] = await Promise.all([loadFreezes(window), serviceIdsOfAssets(subject.assetIds)]);
  const hitIds = new Set(freezeHits(window, { groupId: subject.groupId, serviceIds }, freezes).map((f) => f.id));
  return freezes.filter((f) => hitIds.has(f.id));
}

/** Statuses in which a change still has to clear the freeze rules: nothing is running or finished yet. */
const FREEZE_CHECKED_STATUSES: readonly string[] = ["APPROVAL"];

/**
 * Why a change's scope may not change: adding an affected CI or moving to another team can
 * pull its planned window into a scoped freeze it cleared before. Null when the change
 * stays clear of every freeze. An EMERGENCY change may override freezes, so it is never refused here.
 */
export async function scopeChangeFreezeError(
  changeId: number,
  scope: { addAssetId?: string; groupId?: string | null },
): Promise<string | null> {
  const change = await db.change.findUnique({
    where: { id: changeId },
    select: { type: true, status: true, groupId: true, plannedStart: true, plannedEnd: true },
  });
  if (!change?.plannedStart || !change.plannedEnd || change.type === "EMERGENCY") return null;
  if (!isWindowEditable(change.status) && !FREEZE_CHECKED_STATUSES.includes(change.status)) return null;

  const assetIds = await assetIdsOfChange(changeId);
  if (scope.addAssetId) assetIds.push(scope.addAssetId);
  const hits = await freezeHitsForWindow(
    { start: change.plannedStart, end: change.plannedEnd },
    { groupId: scope.groupId === undefined ? change.groupId : scope.groupId, assetIds },
  );
  const verdict = freezeVerdict({ type: change.type, hits, justification: null });
  return verdict.ok ? null : verdict.error;
}

export async function assetIdsOfChange(changeId: number): Promise<string[]> {
  const rows = await db.changeAsset.findMany({ where: { changeId }, select: { assetId: true } });
  return rows.map((r) => r.assetId);
}

export type ChangeScheduleCheck = {
  change: ScheduledChange;
  /** Each conflict with the other change's title, for display. */
  conflicts: { conflict: ScheduleConflict; other: ScheduledChange }[];
  freezeHits: FreezeWindowRow[];
};

/** Schedule conflicts and freeze hits of one change; null when it has no planned window. */
export async function loadChangeScheduleCheck(changeId: number): Promise<ChangeScheduleCheck | null> {
  const row = await db.change.findUnique({ where: { id: changeId }, select: scheduledChangeSelect });
  const change = row ? toScheduledChange(row) : null;
  if (!change) return null;
  const window = { start: change.plannedStart, end: change.plannedEnd };

  const [candidateRows, sameService, hits] = await Promise.all([
    db.change.findMany({ where: inRangeWhere(window), select: scheduledChangeSelect, take: CALENDAR_CHANGE_LIMIT }),
    getBoolSetting(SAME_SERVICE_SETTING, true),
    freezeHitsForWindow(window, { groupId: change.groupId, assetIds: change.assetIds }),
  ]);
  const candidates = compact(candidateRows.map(toScheduledChange));
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const mine = conflictsOf(change.id, findConflicts(candidates, { sameService }));
  const conflicts = mine.flatMap((conflict) => {
    const other = byId.get(otherChangeId(change.id, conflict));
    return other ? [{ conflict, other }] : [];
  });
  return { change, conflicts, freezeHits: hits };
}
