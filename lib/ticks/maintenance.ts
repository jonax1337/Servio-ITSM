/**
 * Scheduler tick for maintenance windows: starts due windows, hands updates to
 * the updater sidecar, copies its progress, ends windows and keeps the
 * maintenance flag file in line with the database. Run by lib/scheduler.ts with
 * an overlap guard and error isolation.
 *
 * Decisions live in lib/maintenance-rules.ts (nextWindowStep); this file only does
 * the I/O. Every transition is claimed with a conditional update first, so two
 * overlapping ticks (or a tick in the old and the new container) never both act.
 */
import { db } from "@/lib/db";
import { notifyAdmins, writeAudit } from "@/lib/audit";
import { APP_VERSION, type MaintenanceStatus } from "@/lib/constants";
import {
  OPEN_MAINTENANCE_STATUSES,
  heartbeatFresh,
  nextWindowStep,
  outcomeNotice,
  updaterStaleMs,
  type WindowStep,
} from "@/lib/maintenance-rules";
import { readUpdaterHeartbeat, readUpdaterStatus, requestUpdate, syncMaintenanceFlag, withdrawUpdateRequest } from "@/lib/maintenance";
import { fetchPullSizes, servioImage } from "@/lib/registry-manifest";

type TickRow = Awaited<ReturnType<typeof loadOpenWindows>>[number];

function loadOpenWindows() {
  return db.maintenanceWindow.findMany({
    where: { status: { in: [...OPEN_MAINTENANCE_STATUSES] } },
    orderBy: { startsAt: "asc" },
    include: { createdBy: { select: { email: true } } },
  });
}

/** Move the window out of `from`; false when another tick already moved it. */
async function claim(id: string, from: MaintenanceStatus, data: Record<string, unknown>): Promise<boolean> {
  const claimed = await db.maintenanceWindow.updateMany({ where: { id, status: from }, data });
  return claimed.count > 0;
}

async function finish(row: TickRow, status: MaintenanceStatus, result: string | null, extra: Record<string, unknown> = {}) {
  const claimed = await claim(row.id, row.status as MaintenanceStatus, { status, result, finishedAt: new Date(), ...extra });
  if (!claimed) return;
  await writeAudit({
    action: "UPDATE",
    entity: "MaintenanceWindow",
    entityId: row.id,
    summary: `Maintenance window "${row.title}" ended as ${status}${result ? `: ${result}` : ""}`,
  });
  const notice = outcomeNotice(row, status, result);
  if (notice) await notifyAdmins({ type: "MAINTENANCE", ...notice });
}

/**
 * A running update that fails here never got the updater's result: its request
 * is withdrawn first, so a late updater cannot still take the app down for a
 * window that already reads FAILED.
 */
async function failWindow(row: TickRow, result: string) {
  if (row.kind === "UPDATE" && row.status === "IN_PROGRESS" && !withdrawUpdateRequest(row.id)) {
    result += " The update request could not be withdrawn: if the updater comes back, it may still run it.";
  }
  await finish(row, "FAILED", result);
}

async function startWindow(row: TickRow) {
  if (!(await claim(row.id, "SCHEDULED", { status: "IN_PROGRESS", startedAt: new Date() }))) return;
  await writeAudit({
    action: "UPDATE",
    entity: "MaintenanceWindow",
    entityId: row.id,
    summary: `Maintenance window "${row.title}" started`,
  });
}

async function startUpdate(row: TickRow) {
  const claimed = await claim(row.id, "SCHEDULED", {
    status: "IN_PROGRESS",
    startedAt: new Date(),
    fromVersion: APP_VERSION,
  });
  // nextWindowStep only requests an update that has a valid target version.
  if (!claimed || !row.targetVersion) return;
  // Best effort (null on any failure): lets the updater check the free space before it pulls.
  const pullSizes = await fetchPullSizes(servioImage(), row.targetVersion, { installedTag: APP_VERSION });
  try {
    requestUpdate({
      id: row.id,
      targetVersion: row.targetVersion,
      requestedBy: row.createdBy?.email ?? "scheduler",
      pullSizes,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await finish({ ...row, status: "IN_PROGRESS" }, "FAILED", `Could not write the update request: ${reason}`);
  }
}

async function syncProgress(row: TickRow, step: Extract<WindowStep, { kind: "sync" }>) {
  if (step.status !== "IN_PROGRESS") {
    await finish(row, step.status, step.result, { log: JSON.stringify(step.log) });
    return;
  }
  await claim(row.id, "IN_PROGRESS", { result: step.result, log: JSON.stringify(step.log) });
}

async function applyStep(row: TickRow, step: WindowStep) {
  if (step.kind === "start") return startWindow(row);
  if (step.kind === "request-update") return startUpdate(row);
  if (step.kind === "fail") return failWindow(row, step.result);
  if (step.kind === "complete") return finish(row, "COMPLETED", null);
  if (step.kind === "sync") return syncProgress(row, step);
}

export async function runMaintenanceTick(): Promise<void> {
  const now = new Date();
  const heartbeat = readUpdaterHeartbeat();
  const context = {
    now,
    heartbeatFresh: heartbeatFresh(heartbeat, now),
    updaterStatus: readUpdaterStatus(),
    currentVersion: APP_VERSION,
    updaterHeartbeat: heartbeat,
    staleAfterMs: updaterStaleMs(process.env.UPDATER_STALE_MINUTES),
  };
  try {
    for (const row of await loadOpenWindows()) {
      await applyStep(row, nextWindowStep(row, context));
    }
  } finally {
    // The flag must follow the database even when a window failed to advance.
    await syncMaintenanceFlag();
  }
}
