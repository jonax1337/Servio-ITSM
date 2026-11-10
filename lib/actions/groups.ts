"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser, hasRole, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { GROUP_TYPES, AUTO_ASSIGN_STRATEGIES, GROUP_MEMBER_ROLES } from "@/lib/constants";
import type { ActionResult } from "@/lib/action-result";
import { groupReferences } from "@/lib/group-references";
import { groupInUseRefusal, groupInUseText } from "@/lib/group-rules";

/** MANAGER+ gate shared by every group mutation (matches createGroup). */
async function requireManager() {
  const me = await getCurrentUser();
  return me && me.isActive && hasRole(me.role as Role, "MANAGER") ? me : null;
}

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" && v !== "" ? v : null));

const createSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  type: z.enum(GROUP_TYPES),
  description: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
  email: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
  managerId: optionalId,
  autoAssign: z.enum(AUTO_ASSIGN_STRATEGIES).default("OFF"),
});

export type ActionState =
  | { error?: string; fieldErrors?: Record<string, string[]> }
  | undefined;

export async function createGroup(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  // DB-truth manager gate, consistent with setGroupAutoAssign (same config field).
  const me = await getCurrentUser();
  if (!me || !me.isActive || !hasRole(me.role as Role, "MANAGER")) return { error: "Not authorised" };

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;

  const existing = await db.group.findUnique({ where: { name: data.name } });
  if (existing) {
    return {
      error: "A group with that name already exists.",
      fieldErrors: { name: ["Name must be unique"] },
    };
  }

  const group = await db.group.create({ data });

  await writeAudit({
    userId: me.id,
    action: "CREATE",
    entity: "Group",
    entityId: group.id,
    summary: `Created group "${group.name}"`,
  });

  revalidatePath("/groups");
  redirect(`/groups/${group.id}`);
}

/** Change a group's auto-assignment strategy (manager+). */
export async function setGroupAutoAssign(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const strategy = String(formData.get("autoAssign") ?? "");
  if (!AUTO_ASSIGN_STRATEGIES.includes(strategy as (typeof AUTO_ASSIGN_STRATEGIES)[number])) return;
  const group = await db.group.findUnique({ where: { id }, select: { id: true } });
  if (!group) return;
  await db.group.update({ where: { id }, data: { autoAssign: strategy } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Group", entityId: id, summary: `Auto-assign set to ${strategy}` });
  revalidatePath(`/groups/${id}`);
}

// ── Edit group details ───────────────────────────────────────────────────────

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2, "Name must be at least 2 characters"),
  type: z.enum(GROUP_TYPES),
  description: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
  email: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
  managerId: optionalId,
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #6366f1")
    .optional(),
});

export async function updateGroup(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const me = await requireManager();
  if (!me) return { error: "Not authorised" };

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const { id, ...data } = parsed.data;

  try {
    await db.group.update({ where: { id }, data });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "A group with that name already exists.", fieldErrors: { name: ["Name must be unique"] } };
    }
    throw e;
  }

  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Group", entityId: id, summary: "Updated group details" });
  revalidatePath(`/groups/${id}`);
  revalidatePath("/groups");
}

// ── Delete group ─────────────────────────────────────────────────────────────
// Memberships cascade. Like DELETE /groups/{id}, the console refuses while anything
// still points at the group (categories, services, catalog items, open tickets,
// problems, changes, schedules, automations, ...): quietly clearing those links would
// break routing. The refusal comes back as a result the confirm dialog toasts, with
// the same counts and hint as the API. Closed work keeps its row and loses the group
// (optional relations → Prisma default SetNull). Redirects to the list on success.

export async function deleteGroup(formData: FormData): Promise<ActionResult | void> {
  const me = await requireManager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const group = await db.group.findUnique({ where: { id }, select: { name: true } });
  if (!group) return;
  const inUse = groupInUseRefusal(await groupReferences(id));
  if (inUse) return { ok: false, error: groupInUseText(inUse) };
  await db.group.delete({ where: { id } });
  await writeAudit({ userId: me.id, action: "DELETE", entity: "Group", entityId: id, summary: `Deleted group "${group.name}"` });
  revalidatePath("/groups");
  redirect("/groups");
}

// ── Membership ───────────────────────────────────────────────────────────────

/** Add a user to a group (manager+). Idempotent on the [groupId, userId] unique. */
export async function addGroupMember(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const groupId = String(formData.get("groupId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "MEMBER");
  if (!groupId || !userId) return;
  if (!GROUP_MEMBER_ROLES.includes(role as (typeof GROUP_MEMBER_ROLES)[number])) return;

  const [group, user] = await Promise.all([
    db.group.findUnique({ where: { id: groupId }, select: { id: true } }),
    db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } }),
  ]);
  if (!group || !user) return;

  await db.groupMember.upsert({
    where: { groupId_userId: { groupId, userId } },
    create: { groupId, userId, role },
    update: {}, // already a member → no-op (don't silently change their role)
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Group", entityId: groupId, summary: `Added ${user.name ?? user.email}` });
  revalidatePath(`/groups/${groupId}`);
}

/** Remove a membership by its id (manager+). */
export async function removeGroupMember(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const memberId = String(formData.get("memberId") ?? "");
  const member = await db.groupMember.findUnique({
    where: { id: memberId },
    select: { groupId: true, user: { select: { name: true, email: true } } },
  });
  if (!member) return;
  await db.groupMember.delete({ where: { id: memberId } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Group", entityId: member.groupId, summary: `Removed ${member.user.name ?? member.user.email}` });
  revalidatePath(`/groups/${member.groupId}`);
}

/** Flip a membership between MEMBER and LEAD (manager+). */
export async function setGroupMemberRole(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const memberId = String(formData.get("memberId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!GROUP_MEMBER_ROLES.includes(role as (typeof GROUP_MEMBER_ROLES)[number])) return;
  const member = await db.groupMember.findUnique({ where: { id: memberId }, select: { groupId: true } });
  if (!member) return;
  await db.groupMember.update({ where: { id: memberId }, data: { role } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Group", entityId: member.groupId, summary: `Set member role to ${role}` });
  revalidatePath(`/groups/${member.groupId}`);
}
