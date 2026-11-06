import { db } from "@/lib/db";
import { MAINTENANCE_FLAG_FILE } from "@/lib/maintenance-flag";
import { readJsonFile, statePath, writeJsonAtomic } from "@/lib/state-dir";
import {
  OPEN_MAINTENANCE_STATUSES,
  flagForWindows,
  parseUpdaterHeartbeat,
  parseUpdaterStatus,
  type BannerWindow,
  type UpdaterHeartbeat,
  type UpdaterStatus,
} from "@/lib/maintenance-rules";

/**
 * DB- and file-backed side of maintenance windows. The files are the contract
 * with proxy.ts and the updater sidecar (docs/updates.md); decisions live in
 * lib/maintenance-rules.ts.
 */

const REQUEST_FILE = ["updater", "request.json"];
const STATUS_FILE = ["updater", "status.json"];
const HEARTBEAT_FILE = ["updater", "heartbeat.json"];

const INACTIVE_FLAG = { active: false };

export const readUpdaterStatus = (): UpdaterStatus | null => parseUpdaterStatus(readJsonFile(statePath(...STATUS_FILE)));

export const readUpdaterHeartbeat = (): UpdaterHeartbeat | null =>
  parseUpdaterHeartbeat(readJsonFile(statePath(...HEARTBEAT_FILE)));

/** Hand an update to the updater: it processes a request whose id differs from its last finished one. */
export function requestUpdate(request: { id: string; targetVersion: string; requestedBy: string }): void {
  writeJsonAtomic(statePath(...REQUEST_FILE), { ...request, requestedAt: new Date().toISOString() });
}

/** Make maintenance.json match the database: active while a blocking window is IN_PROGRESS. Rewrites only on change. */
export async function syncMaintenanceFlag(): Promise<void> {
  const running = await db.maintenanceWindow.findMany({
    where: { status: "IN_PROGRESS", blockAccess: true },
    select: { id: true, title: true, message: true, kind: true, status: true, endsAt: true, blockAccess: true },
  });
  const wanted = flagForWindows(running) ?? INACTIVE_FLAG;
  const file = statePath(MAINTENANCE_FLAG_FILE);
  if (JSON.stringify(readJsonFile(file)) !== JSON.stringify(wanted)) writeJsonAtomic(file, wanted);
}

/** Scheduled and running windows, soonest first: what banners, status pages and overlap checks need. */
export function listOpenWindows(): Promise<BannerWindow[]> {
  return db.maintenanceWindow.findMany({
    where: { status: { in: [...OPEN_MAINTENANCE_STATUSES] } },
    select: {
      id: true,
      title: true,
      message: true,
      kind: true,
      status: true,
      startsAt: true,
      endsAt: true,
      announceHours: true,
      blockAccess: true,
    },
    orderBy: { startsAt: "asc" },
  });
}

const RECENT_WINDOW_COUNT = 20;

/** Open windows plus the most recent finished ones, for the admin table. */
export async function listWindowsForAdmin() {
  const [open, finished] = await Promise.all([
    db.maintenanceWindow.findMany({
      where: { status: { in: [...OPEN_MAINTENANCE_STATUSES] } },
      orderBy: { startsAt: "asc" },
      include: { createdBy: { select: { name: true, email: true } } },
    }),
    db.maintenanceWindow.findMany({
      where: { status: { notIn: [...OPEN_MAINTENANCE_STATUSES] } },
      orderBy: { startsAt: "desc" },
      take: RECENT_WINDOW_COUNT,
      include: { createdBy: { select: { name: true, email: true } } },
    }),
  ]);
  return [...open, ...finished];
}
