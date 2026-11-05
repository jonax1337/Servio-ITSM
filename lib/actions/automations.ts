"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, hasRole, isAgent, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { TRIGGERS, MATCH_TYPES } from "@/lib/automation-defs";
import { parseRule, referencedIds, type ParsedRule } from "@/lib/automation-rules";

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
  isActive: z.string().optional(),
});

export type RuleState =
  | { ok?: boolean; error?: string; fieldErrors?: Record<string, string[]> }
  | undefined;

type ValidRule = Extract<ParsedRule, { ok: true }>;

/** Checks the rule form's posted fields; returns the normalised rule or the state to send back. */
async function validateRuleForm(
  formData: FormData,
): Promise<{ ok: true; fields: z.infer<typeof schema>; rule: ValidRule } | { ok: false; state: RuleState }> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  const rule = parseRule(String(formData.get("conditions") ?? "[]"), String(formData.get("actions") ?? "[]"));
  const fieldErrors: Record<string, string[]> = parsed.success ? {} : parsed.error.flatten().fieldErrors;
  if (!rule.ok) {
    if (rule.errors.conditions.length > 0) fieldErrors.conditions = rule.errors.conditions;
    if (rule.errors.actions.length > 0) fieldErrors.actions = rule.errors.actions;
  } else {
    const missing = await unresolvedReferences(rule.actions);
    if (missing.length > 0) fieldErrors.actions = missing;
  }
  if (!parsed.success || !rule.ok || Object.keys(fieldErrors).length > 0) {
    return { ok: false, state: { error: "Please fix the errors below.", fieldErrors } };
  }
  return { ok: true, fields: parsed.data, rule };
}

/** Messages for actions pointing at an agent or group that no longer exists. */
async function unresolvedReferences(actions: ValidRule["actions"]): Promise<string[]> {
  const { agentIds, groupIds } = referencedIds(actions);
  const [users, groups] = await Promise.all([
    db.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, role: true, isActive: true } }),
    db.group.findMany({ where: { id: { in: groupIds } }, select: { id: true } }),
  ]);
  const usableAgents = new Set(users.filter((u) => u.isActive && isAgent(u.role as Role)).map((u) => u.id));
  const knownGroups = new Set(groups.map((g) => g.id));
  const problems: string[] = [];
  if (agentIds.some((id) => !usableAgents.has(id))) problems.push("An action refers to an agent who is not active.");
  if (groupIds.some((id) => !knownGroups.has(id))) problems.push("An action refers to a group that no longer exists.");
  return problems;
}

export async function createRule(_prev: RuleState, formData: FormData): Promise<RuleState> {
  const me = await requireManager();
  if (!me) return { error: "Not authorised" };
  const checked = await validateRuleForm(formData);
  if (!checked.ok) return checked.state;
  const d = checked.fields;
  const count = await db.automationRule.count();
  const rule = await db.automationRule.create({
    data: {
      name: d.name,
      description: d.description,
      trigger: d.trigger,
      matchType: d.matchType,
      conditions: JSON.stringify(checked.rule.conditions),
      actions: JSON.stringify(checked.rule.actions),
      isActive: d.isActive !== "false",
      order: count,
    },
  });
  await writeAudit({ userId: me.id, action: "CREATE", entity: "AutomationRule", entityId: rule.id, summary: `Created automation "${rule.name}"` });
  revalidatePath("/automations");
  return { ok: true };
}

export async function updateRule(_prev: RuleState, formData: FormData): Promise<RuleState> {
  const me = await requireManager();
  if (!me) return { error: "Not authorised" };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing id" };
  const checked = await validateRuleForm(formData);
  if (!checked.ok) return checked.state;
  const d = checked.fields;
  await db.automationRule.update({
    where: { id },
    data: {
      name: d.name,
      description: d.description,
      trigger: d.trigger,
      matchType: d.matchType,
      conditions: JSON.stringify(checked.rule.conditions),
      actions: JSON.stringify(checked.rule.actions),
    },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "AutomationRule", entityId: id, summary: `Updated automation "${d.name}"` });
  revalidatePath("/automations");
  return { ok: true };
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
