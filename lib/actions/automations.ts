"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, hasRole, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { TRIGGERS, MATCH_TYPES } from "@/lib/automation-defs";

// DB-truth (not the stale JWT): role/isActive rehydrate from the user row so a
// demoted/deactivated manager loses write access immediately.
async function requireManager() {
  const me = await getCurrentUser();
  return me && me.isActive && hasRole(me.role as Role, "MANAGER") ? me : null;
}

const schema = z.object({
  name: z.string().min(2, "Name is required"),
  description: z.string().optional().transform((v) => (v?.trim() ? v.trim() : null)),
  trigger: z.enum(TRIGGERS.map((t) => t.value) as [string, ...string[]]),
  matchType: z.enum(MATCH_TYPES.map((t) => t.value) as [string, ...string[]]),
  conditions: z.string().default("[]"),
  actions: z.string().default("[]"),
  isActive: z.string().optional(),
});

export type RuleState = { error?: string } | undefined;

function normalizeJson(s: string) {
  try {
    const a = JSON.parse(s);
    return JSON.stringify(Array.isArray(a) ? a : []);
  } catch {
    return "[]";
  }
}

export async function createRule(_prev: RuleState, formData: FormData): Promise<RuleState> {
  const me = await requireManager();
  if (!me) return { error: "Not authorised" };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid rule" };
  const d = parsed.data;
  const count = await db.automationRule.count();
  const rule = await db.automationRule.create({
    data: {
      name: d.name,
      description: d.description,
      trigger: d.trigger,
      matchType: d.matchType,
      conditions: normalizeJson(d.conditions),
      actions: normalizeJson(d.actions),
      isActive: d.isActive !== "false",
      order: count,
    },
  });
  await writeAudit({ userId: me.id, action: "CREATE", entity: "AutomationRule", entityId: rule.id, summary: `Created automation "${rule.name}"` });
  revalidatePath("/automations");
  return undefined;
}

export async function updateRule(_prev: RuleState, formData: FormData): Promise<RuleState> {
  const me = await requireManager();
  if (!me) return { error: "Not authorised" };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing id" };
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid rule" };
  const d = parsed.data;
  await db.automationRule.update({
    where: { id },
    data: {
      name: d.name,
      description: d.description,
      trigger: d.trigger,
      matchType: d.matchType,
      conditions: normalizeJson(d.conditions),
      actions: normalizeJson(d.actions),
      isActive: d.isActive !== "false",
    },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "AutomationRule", entityId: id, summary: `Updated automation "${d.name}"` });
  revalidatePath("/automations");
  return undefined;
}

export async function toggleRule(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const rule = await db.automationRule.findUnique({ where: { id } });
  if (!rule) return;
  await db.automationRule.update({ where: { id }, data: { isActive: !rule.isActive } });
  revalidatePath("/automations");
}

/** Move a rule up/down in execution order. Rewrites all order values to a clean
 *  0..n-1 sequence after the swap, so duplicate/legacy order values self-heal. */
export async function moveRule(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const dir = String(formData.get("direction") ?? "");
  if (dir !== "up" && dir !== "down") return;

  const rules = await db.automationRule.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const idx = rules.findIndex((r) => r.id === id);
  const swapIdx = dir === "up" ? idx - 1 : idx + 1;
  if (idx === -1 || swapIdx < 0 || swapIdx >= rules.length) return;

  [rules[idx], rules[swapIdx]] = [rules[swapIdx], rules[idx]];
  await db.$transaction(rules.map((r, i) => db.automationRule.update({ where: { id: r.id }, data: { order: i } })));
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "AutomationRule", entityId: id, summary: `Moved automation ${dir}` });
  revalidatePath("/automations");
}

export async function deleteRule(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  // deleteMany: no throw when the rule is already gone; skip revalidate on a no-op.
  const gone = await db.automationRule.deleteMany({ where: { id } }).catch(() => null);
  if (!gone || gone.count === 0) return;
  revalidatePath("/automations");
}
