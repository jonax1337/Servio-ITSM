import { db } from "@/lib/db";
import { hasRole, isAgent, type Role } from "@/lib/session";
import { notify, writeAudit } from "@/lib/audit";
import type { ActionResult } from "@/lib/action-result";
import { canCreateOverride, canRemoveOverride, overrideWindowError } from "@/lib/oncall-rules";

// Override persistence shared by the on-call server actions and Sable's
// oncall.override operation, so both enforce the same rules.

export type OverrideActor = { id: string; role: Role };

export type NewOverride = {
  scheduleId: string;
  userId: string;
  replacesUserId: string | null;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
};

const formatWindow = (startsAt: Date, endsAt: Date) =>
  `${startsAt.toISOString().slice(0, 16).replace("T", " ")} – ${endsAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export async function addOnCallOverride(actor: OverrideActor, input: NewOverride): Promise<ActionResult> {
  const schedule = await db.onCallSchedule.findUnique({
    where: { id: input.scheduleId },
    select: {
      id: true,
      name: true,
      rotationType: true,
      customIntervalHours: true,
      handoffTime: true,
      timezone: true,
      rotationStart: true,
      members: { orderBy: { position: "asc" }, select: { userId: true } },
    },
  });
  if (!schedule) return { ok: false, error: "Schedule not found." };

  const isManager = hasRole(actor.role, "MANAGER");
  const rotation = { ...schedule, memberIds: schedule.members.map((m) => m.userId) };
  if (!canCreateOverride({ id: actor.id, isManager }, input, rotation)) {
    return {
      ok: false,
      error: isManager ? "Not authorised." : "You can only hand your own rotation shift to a colleague, within that shift.",
    };
  }

  const windowError = overrideWindowError(input.startsAt, input.endsAt, new Date());
  if (windowError) return { ok: false, error: windowError };

  const cover = await db.user.findUnique({
    where: { id: input.userId },
    select: { isActive: true, role: true },
  });
  if (!cover?.isActive || !isAgent(cover.role as Role)) {
    return { ok: false, error: "The person on call must be an active agent." };
  }

  const clash = await db.onCallOverride.findFirst({
    where: { scheduleId: schedule.id, startsAt: { lt: input.endsAt }, endsAt: { gt: input.startsAt } },
    select: { startsAt: true, endsAt: true },
  });
  if (clash) {
    return { ok: false, error: `Overlaps an existing override (${formatWindow(clash.startsAt, clash.endsAt)}).` };
  }

  const created = await db.onCallOverride.create({ data: input, select: { id: true } });
  const window = formatWindow(input.startsAt, input.endsAt);
  await writeAudit({
    userId: actor.id,
    action: "UPDATE",
    entity: "OnCallSchedule",
    entityId: schedule.id,
    summary: `Added on-call override for "${schedule.name}" (${window})`,
    meta: { overrideId: created.id, userId: input.userId, replacesUserId: input.replacesUserId },
  });
  const notice = { type: "ONCALL", entity: "OnCallSchedule", entityId: schedule.id };
  if (input.userId !== actor.id) {
    await notify(input.userId, { ...notice, title: "You are on call", body: `${schedule.name}: ${window}` });
  }
  if (input.replacesUserId && input.replacesUserId !== actor.id) {
    await notify(input.replacesUserId, {
      ...notice,
      title: "Your on-call shift was covered",
      body: `${schedule.name}: ${window}`,
    });
  }
  return { ok: true };
}

export async function removeOnCallOverride(actor: OverrideActor, overrideId: string): Promise<ActionResult> {
  const override = await db.onCallOverride.findUnique({
    where: { id: overrideId },
    select: { scheduleId: true, userId: true, replacesUserId: true, schedule: { select: { name: true } } },
  });
  if (!override) return { ok: false, error: "Override not found." };
  if (!canRemoveOverride({ id: actor.id, isManager: hasRole(actor.role, "MANAGER") }, override)) {
    return { ok: false, error: "Not authorised." };
  }
  await db.onCallOverride.deleteMany({ where: { id: overrideId } });
  await writeAudit({
    userId: actor.id,
    action: "UPDATE",
    entity: "OnCallSchedule",
    entityId: override.scheduleId,
    summary: `Removed on-call override from "${override.schedule.name}"`,
  });
  return { ok: true };
}
