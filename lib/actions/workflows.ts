"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser, hasRole, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { defaultMap, entityStatuses, isWorkflowEntity } from "@/lib/workflow";

// DB-truth (not the stale JWT): role/isActive rehydrate from the user row so a
// demoted/deactivated manager loses write access immediately.
async function requireManager() {
  const me = await getCurrentUser();
  return me && me.isActive && hasRole(me.role as Role, "MANAGER") ? me : null;
}

const ROLES_ALLOWED = ["MANAGER", "ADMIN"];

type TransitionInput = { fromStatus?: string; toStatus?: string; requiredRole?: string | null };

/**
 * Persist the COMPLETE set of allowed transitions for an entity type (from the
 * visual builder or the matrix editor). We store only the delta vs the built-in
 * lifecycle: built-in transitions the admin dropped become `allowed=false`
 * rows, freehand additions and role gates become `allowed=true` rows.
 */
export async function saveWorkflow(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const entityType = String(formData.get("entityType") ?? "");
  if (!isWorkflowEntity(entityType)) return;

  let input: TransitionInput[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("transitions") ?? "[]"));
    if (Array.isArray(parsed)) input = parsed;
  } catch {
    return;
  }

  const statuses = new Set(entityStatuses(entityType));
  const map = defaultMap(entityType);
  const builtin = new Set<string>();
  for (const from of Object.keys(map)) for (const to of map[from]) builtin.add(`${from}>${to}`);

  // The desired allowed set (validated), pair → role.
  const desired = new Map<string, string | null>();
  for (const t of input) {
    if (!t || typeof t.fromStatus !== "string" || typeof t.toStatus !== "string") continue;
    if (t.fromStatus === t.toStatus) continue;
    if (!statuses.has(t.fromStatus) || !statuses.has(t.toStatus)) continue;
    const role = t.requiredRole && ROLES_ALLOWED.includes(t.requiredRole) ? t.requiredRole : null;
    desired.set(`${t.fromStatus}>${t.toStatus}`, role);
  }

  const rows: { entityType: string; fromStatus: string; toStatus: string; allowed: boolean; requiredRole: string | null }[] = [];
  // Built-in transitions the admin removed.
  for (const k of builtin) {
    if (!desired.has(k)) {
      const [fromStatus, toStatus] = k.split(">");
      rows.push({ entityType, fromStatus, toStatus, allowed: false, requiredRole: null });
    }
  }
  // Freehand additions and role gates (built-in + no gate stays a default, no row).
  for (const [k, role] of desired) {
    const [fromStatus, toStatus] = k.split(">");
    const builtinPair = builtin.has(k);
    if (builtinPair && !role) continue;
    rows.push({ entityType, fromStatus, toStatus, allowed: true, requiredRole: role });
  }

  await db.$transaction([
    db.statusTransition.deleteMany({ where: { entityType } }),
    ...(rows.length ? [db.statusTransition.createMany({ data: rows })] : []),
  ]);

  await writeAudit({ userId: me.id, action: "UPDATE", entity: "StatusTransition", entityId: entityType, summary: `Updated ${entityType} status workflow` });
  revalidatePath("/settings/workflows");
}

/** Drop all overrides for an entity type — back to the built-in default map. */
export async function resetWorkflow(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const entityType = String(formData.get("entityType") ?? "");
  if (!isWorkflowEntity(entityType)) return;

  await db.statusTransition.deleteMany({ where: { entityType } });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "StatusTransition", entityId: entityType, summary: `Reset ${entityType} status workflow to defaults` });
  revalidatePath("/settings/workflows");
}
