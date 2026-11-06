"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, hasRole, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import type { ActionResult } from "@/lib/action-result";
import { ONCALL_ROTATION_TYPES } from "@/lib/constants";
import {
  MAX_CUSTOM_INTERVAL_HOURS,
  MIN_CUSTOM_INTERVAL_HOURS,
  isValidHandoffTime,
  isValidTimeZone,
  parseCalendarDate,
  parseZonedDateTime,
  zonedWallToUtc,
} from "@/lib/oncall-rules";
import { addOnCallOverride, removeOnCallOverride } from "@/lib/oncall-overrides";

export type OnCallFormState =
  | { ok?: boolean; error?: string; fieldErrors?: Record<string, string[]> }
  | undefined;

/** DB-truth gate: the JWT freezes role/isActive at login, so re-read them. */
async function requireActor(min: Role) {
  const me = await getCurrentUser();
  return me?.isActive && hasRole(me.role as Role, min) ? { ...me, role: me.role as Role } : null;
}

function revalidateOnCall(scheduleId?: string) {
  revalidatePath("/oncall");
  if (scheduleId) revalidatePath(`/oncall/${scheduleId}`);
}

const noneToNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s && s !== "none" ? s : null;
};

const scheduleSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
    description: z.string().trim().max(500).optional().default(""),
    groupId: z.string().min(1, "Choose a team"),
    timezone: z.string().refine(isValidTimeZone, "Unknown time zone (use an IANA name like Europe/Berlin)"),
    rotationType: z.enum(ONCALL_ROTATION_TYPES),
    customIntervalHours: z.coerce
      .number()
      .int()
      .min(MIN_CUSTOM_INTERVAL_HOURS, "At least 1 hour")
      .max(MAX_CUSTOM_INTERVAL_HOURS, `At most ${MAX_CUSTOM_INTERVAL_HOURS} hours`)
      .nullable()
      .optional(),
    handoffTime: z.string().refine(isValidHandoffTime, "Use the HH:mm format"),
    startDate: z.string().refine((v) => parseCalendarDate(v) !== null, "Choose the first handoff date"),
    isActive: z.boolean(),
    memberIds: z.array(z.string()).min(1, "Add at least one person to the rotation"),
  })
  .refine((d) => d.rotationType !== "CUSTOM" || d.customIntervalHours != null, {
    path: ["customIntervalHours"],
    message: "Enter the shift length in hours",
  });

function readScheduleForm(formData: FormData) {
  const intervalRaw = String(formData.get("customIntervalHours") ?? "").trim();
  return scheduleSchema.safeParse({
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    groupId: String(formData.get("groupId") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
    rotationType: formData.get("rotationType"),
    customIntervalHours: intervalRaw ? intervalRaw : null,
    handoffTime: String(formData.get("handoffTime") ?? ""),
    startDate: String(formData.get("startDate") ?? ""),
    isActive: formData.get("isActive") !== "false",
    memberIds: [...new Set(formData.getAll("memberIds").map(String).filter(Boolean))],
  });
}

type ScheduleData = z.infer<typeof scheduleSchema>;

/** Check the team and the rotation members exist; returns an error message or null. */
async function referenceError(d: ScheduleData): Promise<string | null> {
  const [group, members] = await Promise.all([
    db.group.findUnique({ where: { id: d.groupId }, select: { id: true } }),
    db.user.findMany({
      where: { id: { in: d.memberIds }, isActive: true, role: { in: ["ADMIN", "MANAGER", "AGENT"] } },
      select: { id: true },
    }),
  ]);
  if (!group) return "That team no longer exists.";
  if (members.length !== d.memberIds.length) return "Every rotation member must be an active agent.";
  return null;
}

function scheduleColumns(d: ScheduleData) {
  const date = parseCalendarDate(d.startDate)!;
  return {
    name: d.name,
    description: d.description || null,
    groupId: d.groupId,
    timezone: d.timezone,
    rotationType: d.rotationType,
    customIntervalHours: d.rotationType === "CUSTOM" ? d.customIntervalHours ?? null : null,
    handoffTime: d.handoffTime,
    rotationStart: zonedWallToUtc(date, d.handoffTime, d.timezone),
    isActive: d.isActive,
  };
}

const memberRows = (scheduleId: string, memberIds: string[]) =>
  memberIds.map((userId, position) => ({ scheduleId, userId, position }));

export async function createSchedule(_prev: OnCallFormState, formData: FormData): Promise<OnCallFormState> {
  const me = await requireActor("MANAGER");
  if (!me) return { error: "Not authorised" };

  const parsed = readScheduleForm(formData);
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const refError = await referenceError(parsed.data);
  if (refError) return { error: refError };

  const schedule = await db.onCallSchedule.create({
    data: { ...scheduleColumns(parsed.data), members: { create: parsed.data.memberIds.map((userId, position) => ({ userId, position })) } },
    select: { id: true, name: true },
  });
  await writeAudit({
    userId: me.id,
    action: "CREATE",
    entity: "OnCallSchedule",
    entityId: schedule.id,
    summary: `Created on-call schedule "${schedule.name}"`,
  });
  revalidateOnCall();
  redirect(`/oncall/${schedule.id}`);
}

export async function updateSchedule(_prev: OnCallFormState, formData: FormData): Promise<OnCallFormState> {
  const me = await requireActor("MANAGER");
  if (!me) return { error: "Not authorised" };
  const id = String(formData.get("id") ?? "");

  const parsed = readScheduleForm(formData);
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const refError = await referenceError(parsed.data);
  if (refError) return { error: refError };

  const existing = await db.onCallSchedule.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { error: "Schedule not found." };

  await db.$transaction([
    db.onCallSchedule.update({ where: { id }, data: scheduleColumns(parsed.data) }),
    db.onCallMember.deleteMany({ where: { scheduleId: id } }),
    db.onCallMember.createMany({ data: memberRows(id, parsed.data.memberIds) }),
  ]);
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "OnCallSchedule",
    entityId: id,
    summary: `Updated on-call schedule "${parsed.data.name}"`,
  });
  revalidateOnCall(id);
  return { ok: true };
}

/** Switch a schedule on or off without opening the full edit form. Inactive schedules are skipped when resolving who is on call. */
export async function setScheduleActive(formData: FormData): Promise<ActionResult> {
  const me = await requireActor("MANAGER");
  if (!me) return { ok: false, error: "Not authorised" };
  const id = String(formData.get("id") ?? "");
  const isActive = formData.get("active") === "true";
  const schedule = await db.onCallSchedule.findUnique({ where: { id }, select: { name: true } });
  if (!schedule) return { ok: false, error: "Schedule not found." };

  await db.onCallSchedule.update({ where: { id }, data: { isActive } });
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "OnCallSchedule",
    entityId: id,
    summary: `${isActive ? "Activated" : "Deactivated"} on-call schedule "${schedule.name}"`,
  });
  revalidateOnCall(id);
  return { ok: true };
}

export async function deleteSchedule(formData: FormData): Promise<ActionResult> {
  const me = await requireActor("MANAGER");
  if (!me) return { ok: false, error: "Not authorised" };
  const id = String(formData.get("id") ?? "");
  const schedule = await db.onCallSchedule.findUnique({ where: { id }, select: { name: true } });
  if (!schedule) return { ok: false, error: "Schedule not found." };

  await db.onCallSchedule.deleteMany({ where: { id } });
  await writeAudit({
    userId: me.id,
    action: "DELETE",
    entity: "OnCallSchedule",
    entityId: id,
    summary: `Deleted on-call schedule "${schedule.name}"`,
  });
  revalidateOnCall();
  redirect("/oncall");
}

const overrideSchema = z.object({
  scheduleId: z.string().min(1),
  userId: z.string().min(1, "Choose who is on call."),
  replacesUserId: z.string().nullable(),
  startsAt: z.string().min(1, "Enter a start."),
  endsAt: z.string().min(1, "Enter an end."),
  reason: z.string().trim().max(300, "The reason can be at most 300 characters.").optional().default(""),
});

const deleteOverrideSchema = z.object({ id: z.string().min(1), scheduleId: z.string() });

const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Invalid input.";

export async function createOverride(formData: FormData): Promise<ActionResult> {
  const me = await requireActor("AGENT");
  if (!me) return { ok: false, error: "Not authorised" };

  const parsed = overrideSchema.safeParse({
    scheduleId: String(formData.get("scheduleId") ?? ""),
    userId: noneToNull(formData.get("userId")) ?? "",
    replacesUserId: noneToNull(formData.get("replacesUserId")),
    startsAt: String(formData.get("startsAt") ?? ""),
    endsAt: String(formData.get("endsAt") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;

  const schedule = await db.onCallSchedule.findUnique({ where: { id: input.scheduleId }, select: { timezone: true } });
  if (!schedule) return { ok: false, error: "Schedule not found." };

  const result = await addOnCallOverride(me, {
    scheduleId: input.scheduleId,
    userId: input.userId,
    replacesUserId: input.replacesUserId,
    startsAt: parseZonedDateTime(input.startsAt, schedule.timezone),
    endsAt: parseZonedDateTime(input.endsAt, schedule.timezone),
    reason: input.reason || null,
  });
  if (result.ok) revalidateOnCall(input.scheduleId);
  return result;
}

export async function deleteOverride(formData: FormData): Promise<ActionResult> {
  const me = await requireActor("AGENT");
  if (!me) return { ok: false, error: "Not authorised" };
  const parsed = deleteOverrideSchema.safeParse({
    id: String(formData.get("id") ?? ""),
    scheduleId: String(formData.get("scheduleId") ?? ""),
  });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };

  const result = await removeOnCallOverride(me, parsed.data.id);
  if (result.ok) revalidateOnCall(parsed.data.scheduleId);
  return result;
}
