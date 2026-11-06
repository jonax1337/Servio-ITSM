"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, hasRole, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { PRIORITIES, ESCALATION_ACTIONS } from "@/lib/constants";
import { WEEKDAY_KEYS } from "@/lib/business-hours";
import { isOnCallEscalationAction } from "@/lib/oncall-rules";

// DB-truth (not the stale JWT): a demoted/deactivated manager must lose write access
// immediately, consistent with the requireRole gate on the pages.
async function requireManager() {
  const me = await getCurrentUser();
  return me && me.isActive && hasRole(me.role as Role, "MANAGER") ? me : null;
}

const nameTaken = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

export type SlaState =
  | { ok?: boolean; error?: string; fieldErrors?: Record<string, string[]> }
  | undefined;

const schema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(80),
  description: z.string().optional().default(""),
  priority: z.enum(PRIORITIES).nullable().optional(),
  responseMins: z.coerce.number().int().min(1, "Must be at least 1 minute").max(1_000_000),
  resolveMins: z.coerce.number().int().min(1, "Must be at least 1 minute").max(1_000_000),
  businessCalendarId: z.string().nullable().optional(),
  escalationPolicyId: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
});

const noneToNull = (v: string) => (v && v !== "none" ? v : null);

function parse(formData: FormData) {
  const priorityRaw = String(formData.get("priority") ?? "");
  return schema.safeParse({
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    priority: priorityRaw && priorityRaw !== "none" ? priorityRaw : null,
    responseMins: String(formData.get("responseMins") ?? ""),
    resolveMins: String(formData.get("resolveMins") ?? ""),
    businessCalendarId: noneToNull(String(formData.get("businessCalendarId") ?? "")),
    escalationPolicyId: noneToNull(String(formData.get("escalationPolicyId") ?? "")),
    isActive: formData.get("isActive") !== "false",
  });
}

export async function createSla(_prev: SlaState, formData: FormData): Promise<SlaState> {
  const me = await requireManager();
  if (!me) return { error: "You need manager access to manage SLAs." };
  const parsed = parse(formData);
  if (!parsed.success) return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;

  // SLA.name is unique — surface a friendly message on collision (pre-check for the
  // common case, catch P2002 for the concurrent race).
  const clash = await db.sLA.findUnique({ where: { name: d.name }, select: { id: true } });
  if (clash) return { error: "An SLA with that name already exists.", fieldErrors: { name: ["Name must be unique"] } };

  try {
    const sla = await db.sLA.create({
      data: {
        name: d.name,
        description: d.description || null,
        priority: d.priority ?? null,
        responseMins: d.responseMins,
        resolveMins: d.resolveMins,
        businessCalendarId: d.businessCalendarId ?? null,
        escalationPolicyId: d.escalationPolicyId ?? null,
        isActive: d.isActive,
      },
    });
    await writeAudit({ userId: me.id, action: "CREATE", entity: "SLA", entityId: sla.id, summary: `Created SLA "${sla.name}"` });
  } catch (e) {
    if (nameTaken(e)) return { error: "An SLA with that name already exists.", fieldErrors: { name: ["Name must be unique"] } };
    throw e;
  }
  revalidatePath("/settings/sla");
  return { ok: true };
}

export async function updateSla(_prev: SlaState, formData: FormData): Promise<SlaState> {
  const me = await requireManager();
  if (!me) return { error: "You need manager access to manage SLAs." };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing SLA id." };
  const parsed = parse(formData);
  if (!parsed.success) return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;

  const clash = await db.sLA.findFirst({ where: { name: d.name, NOT: { id } }, select: { id: true } });
  if (clash) return { error: "An SLA with that name already exists.", fieldErrors: { name: ["Name must be unique"] } };

  try {
    await db.sLA.update({
      where: { id },
      data: {
        name: d.name,
        description: d.description || null,
        priority: d.priority ?? null,
        responseMins: d.responseMins,
        resolveMins: d.resolveMins,
        businessCalendarId: d.businessCalendarId ?? null,
        escalationPolicyId: d.escalationPolicyId ?? null,
        isActive: d.isActive,
      },
    });
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "SLA", entityId: id, summary: `Updated SLA "${d.name}"` });
  } catch (e) {
    if (nameTaken(e)) return { error: "An SLA with that name already exists.", fieldErrors: { name: ["Name must be unique"] } };
    throw e;
  }
  revalidatePath("/settings/sla");
  return { ok: true };
}

export async function toggleSla(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const sla = await db.sLA.findUnique({ where: { id } });
  if (!sla) return;
  await db.sLA.update({ where: { id }, data: { isActive: !sla.isActive } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "SLA", entityId: id, summary: `${sla.isActive ? "Deactivated" : "Activated"} SLA "${sla.name}"` });
  revalidatePath("/settings/sla");
}

export async function deleteSla(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const sla = await db.sLA.findUnique({ where: { id }, select: { name: true } });
  if (!sla) return;
  // Detach references first so the delete can't fail on a foreign key. Existing
  // tickets keep their already-stamped deadlines (the commitment stands) — only
  // the SLA link is removed.
  await db.ticket.updateMany({ where: { slaId: id }, data: { slaId: null } });
  await db.service.updateMany({ where: { slaId: id }, data: { slaId: null } });
  try {
    await db.sLA.delete({ where: { id } });
    // Audit only a delete that actually happened.
    await writeAudit({ userId: me.id, action: "DELETE", entity: "SLA", entityId: id, summary: `Deleted SLA "${sla.name}"` });
  } catch {
    // already gone / concurrent delete — nothing to record
  }
  revalidatePath("/settings/sla");
}

// ===========================================================================
// Business calendars (+ holidays)
// ===========================================================================

// Validate the weeklyHours JSON: an object keyed by lowercase weekday → array
// of ["HH:MM","HH:MM"] window pairs. Kept permissive but shape-checked so the
// business-hours engine never chokes on stored data.
const HHMM = /^([01]?\d|2[0-4]):[0-5]\d$/;
const windowPair = z.tuple([z.string().regex(HHMM), z.string().regex(HHMM)]);
const weeklyHoursSchema = z
  .object(Object.fromEntries(WEEKDAY_KEYS.map((k) => [k, z.array(windowPair).optional()])))
  .partial();

const calendarSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(80),
  timezone: z.string().min(1).max(64).default("UTC"),
  weeklyHours: z.string().default("{}"),
});

function parseCalendar(formData: FormData) {
  const raw = String(formData.get("weeklyHours") ?? "{}");
  // Validate the JSON shape; normalize to a compact string.
  let weeklyHours = "{}";
  try {
    const parsed = weeklyHoursSchema.parse(JSON.parse(raw || "{}"));
    weeklyHours = JSON.stringify(parsed);
  } catch {
    return { ok: false as const };
  }
  const base = calendarSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    timezone: String(formData.get("timezone") ?? "UTC") || "UTC",
    weeklyHours,
  });
  return base.success ? { ok: true as const, data: base.data } : { ok: false as const, err: base.error };
}

export async function createCalendar(_prev: SlaState, formData: FormData): Promise<SlaState> {
  const me = await requireManager();
  if (!me) return { error: "You need manager access to manage calendars." };
  const parsed = parseCalendar(formData);
  if (!parsed.ok) return { error: "Please fix the calendar fields.", fieldErrors: parsed.err?.flatten().fieldErrors };
  const cal = await db.businessCalendar.create({
    data: { name: parsed.data.name, timezone: parsed.data.timezone, weeklyHours: parsed.data.weeklyHours },
  });
  await writeAudit({ userId: me.id, action: "CREATE", entity: "BusinessCalendar", entityId: cal.id, summary: `Created business calendar "${cal.name}"` });
  revalidatePath("/settings/sla");
  return { ok: true };
}

export async function updateCalendar(_prev: SlaState, formData: FormData): Promise<SlaState> {
  const me = await requireManager();
  if (!me) return { error: "You need manager access to manage calendars." };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing calendar id." };
  const parsed = parseCalendar(formData);
  if (!parsed.ok) return { error: "Please fix the calendar fields.", fieldErrors: parsed.err?.flatten().fieldErrors };
  await db.businessCalendar.update({
    where: { id },
    data: { name: parsed.data.name, timezone: parsed.data.timezone, weeklyHours: parsed.data.weeklyHours },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "BusinessCalendar", entityId: id, summary: `Updated business calendar "${parsed.data.name}"` });
  revalidatePath("/settings/sla");
  return { ok: true };
}

export async function deleteCalendar(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const cal = await db.businessCalendar.findUnique({ where: { id }, select: { name: true } });
  if (!cal) return;
  // Detach from SLAs first (they fall back to 24/7 wall-clock). Holidays cascade.
  await db.sLA.updateMany({ where: { businessCalendarId: id }, data: { businessCalendarId: null } });
  try {
    await db.businessCalendar.delete({ where: { id } });
    await writeAudit({ userId: me.id, action: "DELETE", entity: "BusinessCalendar", entityId: id, summary: `Deleted business calendar "${cal.name}"` });
  } catch {
    /* concurrent delete */
  }
  revalidatePath("/settings/sla");
}

export async function addHoliday(_prev: SlaState, formData: FormData): Promise<SlaState> {
  const me = await requireManager();
  if (!me) return { error: "You need manager access to manage calendars." };
  const calendarId = String(formData.get("calendarId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const dateRaw = String(formData.get("date") ?? "");
  if (!calendarId) return { error: "Missing calendar." };
  if (!name) return { error: "Holiday name is required.", fieldErrors: { name: ["Required"] } };
  const date = new Date(`${dateRaw}T00:00:00.000Z`);
  if (isNaN(date.getTime())) return { error: "Invalid date.", fieldErrors: { date: ["Invalid date"] } };
  await db.holiday.create({ data: { calendarId, name, date } });
  await writeAudit({ userId: me.id, action: "CREATE", entity: "Holiday", entityId: calendarId, summary: `Added holiday "${name}"` });
  revalidatePath("/settings/sla");
  return { ok: true };
}

export async function deleteHoliday(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  try {
    await db.holiday.delete({ where: { id } });
    await writeAudit({ userId: me.id, action: "DELETE", entity: "Holiday", entityId: id, summary: "Removed holiday" });
  } catch {
    /* already gone */
  }
  revalidatePath("/settings/sla");
}

// ===========================================================================
// Escalation policies (+ ordered steps)
// ===========================================================================

export async function createPolicy(_prev: SlaState, formData: FormData): Promise<SlaState> {
  const me = await requireManager();
  if (!me) return { error: "You need manager access to manage escalation policies." };
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { error: "Name must be at least 2 characters.", fieldErrors: { name: ["Too short"] } };
  const policy = await db.escalationPolicy.create({ data: { name } });
  await writeAudit({ userId: me.id, action: "CREATE", entity: "EscalationPolicy", entityId: policy.id, summary: `Created escalation policy "${name}"` });
  revalidatePath("/settings/sla");
  return { ok: true };
}

export async function updatePolicy(_prev: SlaState, formData: FormData): Promise<SlaState> {
  const me = await requireManager();
  if (!me) return { error: "You need manager access to manage escalation policies." };
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id) return { error: "Missing policy id." };
  if (name.length < 2) return { error: "Name must be at least 2 characters.", fieldErrors: { name: ["Too short"] } };
  await db.escalationPolicy.update({ where: { id }, data: { name } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "EscalationPolicy", entityId: id, summary: `Renamed escalation policy to "${name}"` });
  revalidatePath("/settings/sla");
  return { ok: true };
}

export async function deletePolicy(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const policy = await db.escalationPolicy.findUnique({ where: { id }, select: { name: true } });
  if (!policy) return;
  // Detach from SLAs first. Steps cascade on policy delete.
  await db.sLA.updateMany({ where: { escalationPolicyId: id }, data: { escalationPolicyId: null } });
  try {
    await db.escalationPolicy.delete({ where: { id } });
    await writeAudit({ userId: me.id, action: "DELETE", entity: "EscalationPolicy", entityId: id, summary: `Deleted escalation policy "${policy.name}"` });
  } catch {
    /* concurrent delete */
  }
  revalidatePath("/settings/sla");
}

const stepSchema = z.object({
  thresholdPercent: z.coerce.number().int().min(1, "1–1000%").max(1000),
  action: z.enum(ESCALATION_ACTIONS),
  targetGroupId: z.string().nullable().optional(),
  targetUserId: z.string().nullable().optional(),
  bumpToPriority: z.enum(PRIORITIES).nullable().optional(),
});

export async function addStep(_prev: SlaState, formData: FormData): Promise<SlaState> {
  const me = await requireManager();
  if (!me) return { error: "You need manager access to manage escalation policies." };
  const policyId = String(formData.get("policyId") ?? "");
  if (!policyId) return { error: "Missing policy." };
  const parsed = stepSchema.safeParse({
    thresholdPercent: String(formData.get("thresholdPercent") ?? ""),
    action: String(formData.get("action") ?? ""),
    targetGroupId: noneToNull(String(formData.get("targetGroupId") ?? "")),
    targetUserId: noneToNull(String(formData.get("targetUserId") ?? "")),
    bumpToPriority: noneToNull(String(formData.get("bumpToPriority") ?? "")),
  });
  if (!parsed.success) return { error: "Please fix the step fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;

  // Semantic guards per action.
  if (d.action === "BUMP_PRIORITY" && !d.bumpToPriority) {
    return { error: "Choose a target priority for a Bump priority step.", fieldErrors: { bumpToPriority: ["Required"] } };
  }
  if (d.action === "REASSIGN" && !d.targetGroupId && !d.targetUserId) {
    return { error: "Choose a target group or user for a Reassign step.", fieldErrors: { targetGroupId: ["Pick a target"] } };
  }
  if (d.action === "NOTIFY" && !d.targetGroupId && !d.targetUserId) {
    return { error: "Choose someone to notify.", fieldErrors: { targetGroupId: ["Pick a target"] } };
  }

  // BUMP_PRIORITY and the on-call actions carry no fixed user/group target.
  const usesTargets = d.action !== "BUMP_PRIORITY" && !isOnCallEscalationAction(d.action);

  // Append at the end (next order index).
  const last = await db.escalationStep.findFirst({ where: { policyId }, orderBy: { order: "desc" }, select: { order: true } });
  const order = (last?.order ?? -1) + 1;
  await db.escalationStep.create({
    data: {
      policyId,
      order,
      thresholdPercent: d.thresholdPercent,
      action: d.action,
      targetGroupId: usesTargets ? d.targetGroupId ?? null : null,
      targetUserId: usesTargets ? d.targetUserId ?? null : null,
      bumpToPriority: d.action === "BUMP_PRIORITY" ? d.bumpToPriority ?? null : null,
    },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "EscalationPolicy", entityId: policyId, summary: `Added ${d.action} step at ${d.thresholdPercent}%` });
  revalidatePath("/settings/sla");
  return { ok: true };
}

export async function deleteStep(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const step = await db.escalationStep.findUnique({ where: { id }, select: { policyId: true } });
  if (!step) return;
  try {
    await db.escalationStep.delete({ where: { id } });
    await writeAudit({ userId: me.id, action: "UPDATE", entity: "EscalationPolicy", entityId: step.policyId, summary: "Removed escalation step" });
  } catch {
    /* already gone */
  }
  revalidatePath("/settings/sla");
}
