"use server";

import { revalidatePath } from "next/cache";
import { isValid } from "date-fns";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireManagerUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { describeFreeze, freezeWindowError } from "@/lib/change-schedule-rules";
import type { ActionResult } from "@/lib/action-result";

const refuse = (error: string): ActionResult => ({ ok: false, error });
const OK: ActionResult = { ok: true };

const NOT_AUTHORISED = "Only managers can manage change freeze windows.";

const dateField = (label: string) =>
  z
    .string()
    .refine((v) => isValid(new Date(v)), `${label} must be a valid date and time.`)
    .transform((v) => new Date(v));

const optionalScope = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" ? v : null));

const freezeSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters."),
  reason: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  startsAt: dateField("Start"),
  endsAt: dateField("End"),
  serviceId: optionalScope,
  groupId: optionalScope,
});

const idSchema = z.object({ id: z.string().min(1) });

type FreezeInput = z.infer<typeof freezeSchema>;
type ParsedFreeze = { data: FreezeInput; error?: undefined } | { data?: undefined; error: string };

/** The first problem with the freeze input (shape, window order, unknown scopes), or the parsed data. */
async function parseFreeze(formData: FormData): Promise<ParsedFreeze> {
  const parsed = freezeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  const data = parsed.data;
  const orderError = freezeWindowError(data.startsAt, data.endsAt);
  if (orderError) return { error: orderError };
  if (data.serviceId && !(await db.service.findUnique({ where: { id: data.serviceId }, select: { id: true } }))) {
    return { error: "Service not found." };
  }
  if (data.groupId && !(await db.group.findUnique({ where: { id: data.groupId }, select: { id: true } }))) {
    return { error: "Team not found." };
  }
  return { data };
}

function revalidateFreezeViews() {
  revalidatePath("/changes/freeze");
  revalidatePath("/changes/calendar");
}

export async function createFreezeWindow(formData: FormData): Promise<ActionResult> {
  const me = await requireManagerUser();
  if (!me) return refuse(NOT_AUTHORISED);
  const { data, error } = await parseFreeze(formData);
  if (!data) return refuse(error);

  const freeze = await db.changeFreezeWindow.create({ data });
  await writeAudit({
    userId: me.id,
    action: "CREATE",
    entity: "ChangeFreezeWindow",
    entityId: freeze.id,
    summary: `Created change freeze ${describeFreeze(freeze)}`,
  });
  revalidateFreezeViews();
  return OK;
}

export async function updateFreezeWindow(formData: FormData): Promise<ActionResult> {
  const me = await requireManagerUser();
  if (!me) return refuse(NOT_AUTHORISED);
  const id = idSchema.safeParse(Object.fromEntries(formData));
  if (!id.success) return refuse("Invalid request.");
  const { data, error } = await parseFreeze(formData);
  if (!data) return refuse(error);

  const existing = await db.changeFreezeWindow.findUnique({ where: { id: id.data.id }, select: { id: true } });
  if (!existing) return refuse("Freeze window not found.");

  const freeze = await db.changeFreezeWindow.update({ where: { id: existing.id }, data });
  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "ChangeFreezeWindow",
    entityId: freeze.id,
    summary: `Updated change freeze ${describeFreeze(freeze)}`,
  });
  revalidateFreezeViews();
  return OK;
}

export async function deleteFreezeWindow(formData: FormData): Promise<ActionResult> {
  const me = await requireManagerUser();
  if (!me) return refuse(NOT_AUTHORISED);
  const id = idSchema.safeParse(Object.fromEntries(formData));
  if (!id.success) return refuse("Invalid request.");

  const freeze = await db.changeFreezeWindow.findUnique({ where: { id: id.data.id } });
  if (!freeze) return refuse("Freeze window not found.");

  await db.changeFreezeWindow.delete({ where: { id: freeze.id } });
  await writeAudit({
    userId: me.id,
    action: "DELETE",
    entity: "ChangeFreezeWindow",
    entityId: freeze.id,
    summary: `Deleted change freeze ${describeFreeze(freeze)}`,
  });
  revalidateFreezeViews();
  return OK;
}
