"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { hasRole, type Role, requireAgentUser } from "@/lib/session";

/** Filter params we allow a saved view to carry, per entity. */
const ALLOWED_KEYS: Record<string, string[]> = {
  ticket: ["q", "status", "priority", "type", "group", "assignee", "category", "service"],
  problem: ["q", "status", "priority", "group", "assignee", "category"],
  change: ["q", "status", "risk", "type", "group", "assignee"],
  asset: ["q", "type", "status", "owner", "group"],
};

const BASE_PATH: Record<string, string> = {
  ticket: "/tickets",
  problem: "/problems",
  change: "/changes",
  asset: "/assets",
};

async function requireAgent() {
  // DB-truth guard (role + isActive rehydrated) — see requireAgentUser.
  return requireAgentUser();
}

/** Keep only known keys with short string values → a safe JSON to store. */
function sanitizeFilters(raw: string, entity: string): string {
  const allowed = ALLOWED_KEYS[entity] ?? ALLOWED_KEYS.ticket;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    parsed = {};
  }
  const clean: Record<string, string> = {};
  for (const k of allowed) {
    const v = parsed[k];
    if (typeof v === "string" && v.trim() && v !== "all") clean[k] = v.slice(0, 120);
  }
  return JSON.stringify(clean);
}

export async function createSavedView(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const entity = String(formData.get("entity") ?? "ticket");
  if (!name || !(entity in ALLOWED_KEYS)) return;

  const filters = sanitizeFilters(String(formData.get("filters") ?? "{}"), entity);
  // Only managers+ may publish a shared/team view; everyone else gets a personal one.
  const canShare = hasRole(me.role as Role, "MANAGER");
  const isShared = canShare && formData.get("isShared") === "on";
  const rawGroup = String(formData.get("groupId") ?? "").trim();
  const groupId = isShared && rawGroup && rawGroup !== "none" ? rawGroup : null;

  const order = await db.savedView.count({ where: { ownerId: me.id, entity } });
  await db.savedView.create({
    data: { name, entity, filters, ownerId: me.id, isShared, groupId, order },
  });
  revalidatePath(BASE_PATH[entity] ?? "/tickets");
}

export async function updateSavedView(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const view = await db.savedView.findUnique({ where: { id } });
  if (!view) return;
  // Owner may edit their own; managers may edit shared team views.
  const canManage = view.ownerId === me.id || (view.isShared && hasRole(me.role as Role, "MANAGER"));
  if (!canManage) return;

  const data: Record<string, unknown> = {};
  const name = String(formData.get("name") ?? "").trim();
  if (name) data.name = name.slice(0, 60);
  if (formData.has("filters")) data.filters = sanitizeFilters(String(formData.get("filters") ?? "{}"), view.entity);
  await db.savedView.update({ where: { id }, data });
  revalidatePath(BASE_PATH[view.entity] ?? "/tickets");
}

export async function deleteSavedView(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const view = await db.savedView.findUnique({ where: { id } });
  if (!view) return;
  const canManage =
    view.ownerId === me.id ||
    me.role === "ADMIN" ||
    (view.isShared && hasRole(me.role as Role, "MANAGER"));
  if (!canManage) return;
  await db.savedView.delete({ where: { id } }).catch(() => {});
  revalidatePath(BASE_PATH[view.entity] ?? "/tickets");
}

/** Views visible to a user for an entity: their own + shared team views. */
export async function getVisibleSavedViews(entity: string, userId: string) {
  const memberships = await db.groupMember.findMany({
    where: { userId },
    select: { groupId: true },
  });
  const groupIds = memberships.map((m) => m.groupId);
  const views = await db.savedView.findMany({
    where: {
      entity,
      OR: [
        { ownerId: userId },
        { isShared: true, groupId: null },
        { isShared: true, groupId: { in: groupIds } },
      ],
    },
    include: { owner: { select: { name: true, email: true } } },
    orderBy: [{ isShared: "asc" }, { order: "asc" }, { createdAt: "asc" }],
  });
  return views;
}
