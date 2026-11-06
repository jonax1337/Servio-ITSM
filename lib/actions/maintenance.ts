"use server";

import { revalidatePath } from "next/cache";
import { isValid } from "date-fns";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdminUser } from "@/lib/session";
import { notifyAdmins, writeAudit } from "@/lib/audit";
import { APP_VERSION, MAINTENANCE_KINDS } from "@/lib/constants";
import {
  MAX_ANNOUNCE_HOURS,
  MAX_WINDOW_HOURS,
  abortResult,
  describeWindow,
  heartbeatFresh,
  isAbortable,
  outcomeNotice,
  validateWindow,
  type WindowDraft,
} from "@/lib/maintenance-rules";
import { listOpenWindows, readUpdaterHeartbeat } from "@/lib/maintenance";
import { runMaintenanceTick } from "@/lib/ticks/maintenance";
import { checkForUpdates } from "@/lib/updates";
import type { ActionResult } from "@/lib/action-result";

const refuse = (error: string): ActionResult => ({ ok: false, error });
const OK: ActionResult = { ok: true };

const NOT_AUTHORISED = "Only admins can manage maintenance windows.";
const MINUTE_MS = 60_000;

const optionalText = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

const scheduleSchema = z.object({
  kind: z.enum(MAINTENANCE_KINDS),
  title: z.string().trim().min(2, "Title must be at least 2 characters."),
  message: optionalText,
  startMode: z.enum(["now", "later"]),
  startsAt: optionalText,
  durationMinutes: z.coerce.number().int().min(1, "The window must last at least a minute.").max(MAX_WINDOW_HOURS * 60),
  announceHours: z.coerce.number().int().min(0).max(MAX_ANNOUNCE_HOURS),
  // base-ui Switch submits "on" when checked, nothing when unchecked.
  blockAccess: z.string().optional().transform((v) => v === "on"),
  targetVersion: optionalText,
});

const idSchema = z.object({ id: z.string().min(1) });

type ScheduleInput = z.infer<typeof scheduleSchema>;

/** When the window starts: right now, or the chosen date-time (an ISO string from the browser). */
function startOf(input: ScheduleInput, now: Date): Date | null {
  if (input.startMode === "now") return now;
  const chosen = input.startsAt ? new Date(input.startsAt) : null;
  return chosen && isValid(chosen) ? chosen : null;
}

/** The first reason `draft` is not allowed, checked against the other open windows and the updater. */
async function draftError(draft: WindowDraft, now: Date, ignoreId?: string): Promise<string | null> {
  const open = await listOpenWindows();
  return validateWindow(draft, {
    now,
    existing: open.filter((w) => w.id !== ignoreId),
    currentVersion: APP_VERSION,
    updaterConnected: heartbeatFresh(readUpdaterHeartbeat(), now),
  });
}

function revalidateMaintenanceViews() {
  revalidatePath("/settings/updates");
  revalidatePath("/changes/calendar");
}

/** Run the tick right away so a started or ended window shows its new state without waiting for the schedule. */
async function applyNow() {
  await runMaintenanceTick();
  revalidateMaintenanceViews();
}

export async function scheduleMaintenance(formData: FormData): Promise<ActionResult> {
  const me = await requireAdminUser();
  if (!me) return refuse(NOT_AUTHORISED);
  const parsed = scheduleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return refuse(parsed.error.issues[0]?.message ?? "Invalid request.");
  const input = parsed.data;

  const now = new Date();
  const startsAt = startOf(input, now);
  if (!startsAt) return refuse("Start must be a valid date and time.");
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * MINUTE_MS);
  const draft: WindowDraft = { kind: input.kind, startsAt, endsAt, targetVersion: input.targetVersion };
  const error = await draftError(draft, now);
  if (error) return refuse(error);

  const created = await db.maintenanceWindow.create({
    data: {
      title: input.title,
      message: input.message,
      kind: input.kind,
      startsAt,
      endsAt,
      announceHours: input.announceHours,
      blockAccess: input.blockAccess,
      targetVersion: input.kind === "UPDATE" ? input.targetVersion : null,
      createdById: me.id,
    },
  });
  await writeAudit({
    userId: me.id,
    action: "CREATE",
    entity: "MaintenanceWindow",
    entityId: created.id,
    summary: `Scheduled maintenance ${describeWindow(created)}`,
  });
  if (input.startMode === "now") await applyNow();
  else revalidateMaintenanceViews();
  return OK;
}

/** Move a SCHEDULED window's start to now, keeping its length, then let the tick start it. */
export async function startMaintenanceNow(formData: FormData): Promise<ActionResult> {
  const me = await requireAdminUser();
  if (!me) return refuse(NOT_AUTHORISED);
  const id = idSchema.safeParse(Object.fromEntries(formData));
  if (!id.success) return refuse("Invalid request.");
  const window = await db.maintenanceWindow.findUnique({ where: { id: id.data.id } });
  if (!window || window.status !== "SCHEDULED") return refuse("Only a scheduled window can be started.");

  const now = new Date();
  const endsAt = new Date(now.getTime() + (window.endsAt.getTime() - window.startsAt.getTime()));
  const error = await draftError(
    { kind: window.kind as WindowDraft["kind"], startsAt: now, endsAt, targetVersion: window.targetVersion },
    now,
    window.id,
  );
  if (error) return refuse(error);

  const moved = await db.maintenanceWindow.updateMany({
    where: { id: window.id, status: "SCHEDULED" },
    data: { startsAt: now, endsAt },
  });
  if (moved.count === 0) return refuse("The window was changed in the meantime.");
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "MaintenanceWindow",
    entityId: window.id,
    summary: `Started maintenance window "${window.title}" early`,
  });
  await applyNow();
  return OK;
}

export async function cancelMaintenance(formData: FormData): Promise<ActionResult> {
  const me = await requireAdminUser();
  if (!me) return refuse(NOT_AUTHORISED);
  const id = idSchema.safeParse(Object.fromEntries(formData));
  if (!id.success) return refuse("Invalid request.");
  const window = await db.maintenanceWindow.findUnique({ where: { id: id.data.id } });
  if (!window) return refuse("Maintenance window not found.");

  const cancelled = await db.maintenanceWindow.updateMany({
    where: { id: window.id, status: "SCHEDULED" },
    data: { status: "CANCELLED", finishedAt: new Date() },
  });
  if (cancelled.count === 0) return refuse("Only a scheduled window can be cancelled.");
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "MaintenanceWindow",
    entityId: window.id,
    summary: `Cancelled maintenance ${describeWindow(window)}`,
  });
  revalidateMaintenanceViews();
  return OK;
}

/** End a running general window now. A running update cannot be stopped: the updater owns it. */
export async function endMaintenanceNow(formData: FormData): Promise<ActionResult> {
  const me = await requireAdminUser();
  if (!me) return refuse(NOT_AUTHORISED);
  const id = idSchema.safeParse(Object.fromEntries(formData));
  if (!id.success) return refuse("Invalid request.");

  const ended = await db.maintenanceWindow.updateMany({
    where: { id: id.data.id, status: "IN_PROGRESS", kind: "GENERAL" },
    data: { endsAt: new Date() },
  });
  if (ended.count === 0) return refuse("Only a running maintenance window can be ended.");
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "MaintenanceWindow",
    entityId: id.data.id,
    summary: "Ended a maintenance window early",
  });
  await applyNow();
  return OK;
}

/**
 * Give up on a running update that never reports a result. This only releases the
 * window (and with it maintenance mode): the updater may still be working and the
 * container may be mid-switch, so the UI tells the admin to check the updater first.
 */
export async function abortMaintenance(formData: FormData): Promise<ActionResult> {
  const me = await requireAdminUser();
  if (!me) return refuse(NOT_AUTHORISED);
  const id = idSchema.safeParse(Object.fromEntries(formData));
  if (!id.success) return refuse("Invalid request.");
  const window = await db.maintenanceWindow.findUnique({ where: { id: id.data.id } });
  if (!window || !isAbortable(window)) return refuse("Only a running update can be aborted.");

  const result = abortResult(me.email);
  const aborted = await db.maintenanceWindow.updateMany({
    where: { id: window.id, status: "IN_PROGRESS", kind: "UPDATE" },
    data: { status: "FAILED", result, finishedAt: new Date() },
  });
  if (aborted.count === 0) return refuse("The window already ended.");
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "MaintenanceWindow",
    entityId: window.id,
    summary: `Aborted maintenance ${describeWindow(window)}`,
  });
  const notice = outcomeNotice(window, "FAILED", result);
  if (notice) await notifyAdmins({ type: "MAINTENANCE", ...notice });
  await applyNow();
  return OK;
}

export async function checkForUpdatesNow(): Promise<ActionResult> {
  const me = await requireAdminUser();
  if (!me) return refuse(NOT_AUTHORISED);
  const result = await checkForUpdates();
  revalidatePath("/settings/updates");
  return result.ok ? OK : refuse(result.error);
}
