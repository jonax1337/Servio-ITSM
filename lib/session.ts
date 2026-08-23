import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { db } from "@/lib/db";

export type Role = "ADMIN" | "MANAGER" | "AGENT" | "USER";

const RANK: Record<Role, number> = { USER: 0, AGENT: 1, MANAGER: 2, ADMIN: 3 };

/** The session user (id, role, email, name, image) — or null. */
export const getSessionUser = cache(async () => {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    role: (session.user.role ?? "USER") as Role,
    email: session.user.email ?? "",
    name: session.user.name ?? session.user.email ?? "User",
    image: session.user.image ?? null,
  };
});

/** Full DB user row (cached per request). */
export const getCurrentUser = cache(async () => {
  const s = await getSessionUser();
  if (!s) return null;
  return db.user.findUnique({ where: { id: s.id } });
});

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Rehydrate against the DB: the JWT freezes role/isActive at login, so a
  // deactivated or demoted user would otherwise keep their old access until the
  // token expires. getCurrentUser is cached per request, so this is one query.
  const row = await getCurrentUser();
  if (!row || !row.isActive) redirect("/login");
  return { ...user, role: row.role as Role };
}

/**
 * DB-truth agent guard for server actions: rehydrates role/isActive from the
 * database (the JWT freezes them at login) and requires AGENT or above.
 * Returns the full user row with a typed `role`, or null when not allowed —
 * callers map that to their silent "Not authorised" return, matching the
 * original session-only guards.
 */
export async function requireAgentUser() {
  const s = await getSessionUser();
  if (!s) return null;
  const row = await getCurrentUser();
  if (!row || !row.isActive || !isAgent(row.role as Role)) return null;
  // `name` keeps the session shape's non-null guarantee (falls back to email).
  return { ...row, role: row.role as Role, name: row.name ?? row.email };
}

export function hasRole(role: Role, min: Role) {
  return RANK[role] >= RANK[min];
}

export async function requireRole(min: Role) {
  const user = await requireUser();
  if (!hasRole(user.role, min)) redirect("/portal");
  return user;
}

export function isAgent(role: Role) {
  return RANK[role] >= RANK.AGENT;
}
