"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { hasRole, type Role, requireAgentUser } from "@/lib/session";
import { DEFAULT_LAYOUT, type Widget, type WidgetType, type Tone, type Threshold } from "@/lib/dashboard/types";

const TONES = ["primary", "success", "warning", "danger", "info", "neutral"];
const OPS = ["lt", "lte", "gt", "gte", "eq"];

/** Validate + normalise a widget's options (colours/thresholds are never trusted). */
function sanitizeOptions(o: unknown): Widget["options"] | undefined {
  if (!o || typeof o !== "object") return undefined;
  const w = o as Record<string, unknown>;
  const out: NonNullable<Widget["options"]> = {};
  if (typeof w.groupBy === "string") out.groupBy = w.groupBy as NonNullable<Widget["options"]>["groupBy"];
  if (w.chartType === "bar" || w.chartType === "donut") out.chartType = w.chartType;
  if (typeof w.accent === "string" && TONES.includes(w.accent)) out.accent = w.accent as Tone;
  if (Array.isArray(w.thresholds)) {
    const cleaned = w.thresholds
      .slice(0, 5)
      .map((t) => {
        const tt = t as Record<string, unknown>;
        const value = Number(tt.value);
        return OPS.includes(tt.op as string) && Number.isFinite(value) && TONES.includes(tt.tone as string)
          ? ({ op: tt.op as Threshold["op"], value, tone: tt.tone as Tone } satisfies Threshold)
          : null;
      })
      .filter((t): t is Threshold => t !== null);
    if (cleaned.length) out.thresholds = cleaned;
  }
  return Object.keys(out).length ? out : undefined;
}

async function requireAgent() {
  // DB-truth guard (role + isActive rehydrated) — see requireAgentUser.
  return requireAgentUser();
}

const WIDGET_TYPES: WidgetType[] = ["stat", "breakdown", "volume", "sla", "csat", "aging", "list"];

/** Validate + normalise a widget layout coming from the client (never trusted). */
function sanitizeLayout(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    return "[]";
  }
  if (!Array.isArray(parsed)) return "[]";
  const clean: Widget[] = [];
  for (const item of parsed.slice(0, 40)) {
    const w = item as Record<string, unknown>;
    if (!WIDGET_TYPES.includes(w.type as WidgetType)) continue;
    const filters: Record<string, string> = {};
    if (w.filters && typeof w.filters === "object") {
      for (const [k, v] of Object.entries(w.filters as Record<string, unknown>)) {
        if (typeof v === "string" && v) filters[k] = v.slice(0, 120);
      }
    }
    clean.push({
      id: String(w.id ?? Math.random().toString(36).slice(2)).slice(0, 40),
      type: w.type as WidgetType,
      title: String(w.title ?? "Widget").slice(0, 80),
      filters,
      x: clampInt(w.x, 0, 11),
      y: clampInt(w.y, 0, 200),
      w: clampInt(w.w, 1, 12),
      h: clampInt(w.h, 1, 8),
      options: sanitizeOptions(w.options),
    });
  }
  return JSON.stringify(clean);
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export async function createDashboard(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  if (!name) return;
  const canShare = hasRole(me.role as Role, "MANAGER");
  const isShared = canShare && formData.get("isShared") === "on";
  const rawGroup = String(formData.get("groupId") ?? "").trim();
  const groupId = isShared && rawGroup && rawGroup !== "none" ? rawGroup : null;
  // New dashboards start from the built-in default layout so they're never empty.
  const layoutRaw = formData.get("layout");
  const layout = typeof layoutRaw === "string" && layoutRaw.trim()
    ? sanitizeLayout(layoutRaw)
    : JSON.stringify(DEFAULT_LAYOUT);
  const order = await db.dashboard.count({ where: { ownerId: me.id } });
  const created = await db.dashboard.create({
    data: { name, ownerId: me.id, isShared, groupId, layout, order },
  });
  revalidatePath("/");
  return created.id;
}

export async function setDashboardLayout(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const d = await db.dashboard.findUnique({ where: { id } });
  if (!d) return;
  const canEdit = d.ownerId === me.id || (d.isShared && hasRole(me.role as Role, "MANAGER"));
  if (!canEdit) return;
  await db.dashboard.update({ where: { id }, data: { layout: sanitizeLayout(String(formData.get("layout") ?? "[]")) } });
  revalidatePath("/");
}

/** Update a dashboard's name and (managers only) its sharing scope. */
export async function updateDashboardSettings(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const d = await db.dashboard.findUnique({ where: { id } });
  if (!d) return;
  const canEdit = d.ownerId === me.id || (d.isShared && hasRole(me.role as Role, "MANAGER"));
  if (!canEdit) return;

  const data: Record<string, unknown> = {};
  const name = String(formData.get("name") ?? "").trim();
  if (name) data.name = name.slice(0, 60);

  // Sharing is manager-only; others keep the existing scope.
  if (hasRole(me.role as Role, "MANAGER")) {
    const sharing = String(formData.get("sharing") ?? ""); // private | team | everyone
    const rawGroup = String(formData.get("groupId") ?? "").trim();
    if (sharing === "everyone") {
      data.isShared = true;
      data.groupId = null;
    } else if (sharing === "team") {
      data.isShared = true;
      data.groupId = rawGroup && rawGroup !== "none" ? rawGroup : null;
    } else if (sharing === "private") {
      data.isShared = false;
      data.groupId = null;
    }
  }
  if (Object.keys(data).length === 0) return;
  await db.dashboard.update({ where: { id }, data });
  revalidatePath("/");
}

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

export async function renameDashboard(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const d = await db.dashboard.findUnique({ where: { id } });
  if (!d || !name) return;
  const canEdit = d.ownerId === me.id || (d.isShared && hasRole(me.role as Role, "MANAGER"));
  if (!canEdit) return;
  await db.dashboard.update({ where: { id }, data: { name } });
  revalidatePath("/");
}

export async function deleteDashboard(formData: FormData) {
  const me = await requireAgent();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const d = await db.dashboard.findUnique({ where: { id } });
  if (!d) return;
  const canDelete = d.ownerId === me.id || me.role === "ADMIN" || (d.isShared && hasRole(me.role as Role, "MANAGER"));
  if (!canDelete) return;
  await db.dashboard.delete({ where: { id } }).catch(() => {});
  revalidatePath("/");
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
