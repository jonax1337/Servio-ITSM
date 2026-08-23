import "server-only";

import { db } from "@/lib/db";
import { DEFAULT_LAYOUT } from "@/lib/dashboard/types";

// Server-side read/bootstrap helpers for dashboards and saved views. Kept out
// of the "use server" action modules so they are never exposed as HTTP
// endpoints (they take an arbitrary userId and leak owner name/email).

/**
 * Ensure the user always has their personal "My Dashboard" (the home default),
 * regardless of any other dashboards they've created. Returns its id.
 */
export async function ensurePersonalDashboard(userId: string) {
  const existing = await db.dashboard.findFirst({
    where: { ownerId: userId, isShared: false, name: "My Dashboard" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await db.dashboard.create({
    data: { name: "My Dashboard", ownerId: userId, isShared: false, layout: JSON.stringify(DEFAULT_LAYOUT), order: -1 },
  });
  return created.id;
}

/** Dashboards visible to a user: their own + shared team/org dashboards. */
export async function getVisibleDashboards(userId: string) {
  const memberships = await db.groupMember.findMany({ where: { userId }, select: { groupId: true } });
  const groupIds = memberships.map((m) => m.groupId);
  return db.dashboard.findMany({
    where: {
      OR: [
        { ownerId: userId },
        { isShared: true, groupId: null },
        { isShared: true, groupId: { in: groupIds } },
      ],
    },
    include: { owner: { select: { name: true, email: true } } },
    orderBy: [{ isShared: "asc" }, { order: "asc" }, { createdAt: "asc" }],
  });
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
