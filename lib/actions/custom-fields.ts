"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser, hasRole, isAgent, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { MATCH_TYPES } from "@/lib/automation-defs";
import {
  CUSTOM_FIELD_TYPES, CUSTOM_FIELD_ENTITIES,
  parseValues, validateValue, type CustomFieldDef,
} from "@/lib/custom-fields";

async function requireManager() {
  // DB-truth: rehydrate role + isActive so a demoted/deactivated user with a
  // live JWT can't keep manager-level custom-field admin.
  const me = await getCurrentUser();
  return me && me.isActive && hasRole(me.role as Role, "MANAGER") ? me : null;
}

// Where a change to an entity's custom fields needs to be reflected.
const ENTITY_PATH: Record<string, string> = {
  TICKET: "/tickets",
  PROBLEM: "/problems",
  CHANGE: "/changes",
};

/** Slugify a label into a stable key (a-z, 0-9, underscores). */
function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "field";
}

const defSchema = z.object({
  entityType: z.enum(CUSTOM_FIELD_ENTITIES as unknown as [string, ...string[]]),
  label: z.string().min(2, "Label is required"),
  key: z.string().optional(),
  type: z.enum(CUSTOM_FIELD_TYPES as unknown as [string, ...string[]]),
  options: z.string().default("[]"),
  required: z.string().optional(),
  placeholder: z.string().optional().transform((v) => (v?.trim() ? v.trim() : null)),
  help: z.string().optional().transform((v) => (v?.trim() ? v.trim() : null)),
  matchType: z.enum(MATCH_TYPES.map((t) => t.value) as [string, ...string[]]).default("ALL"),
  visibility: z.string().default("[]"),
  active: z.string().optional(),
});

export type FieldState = { error?: string } | undefined;

function normalizeJson(s: string) {
  try {
    const a = JSON.parse(s);
    return JSON.stringify(Array.isArray(a) ? a : []);
  } catch {
    return "[]";
  }
}

export async function createCustomField(_prev: FieldState, formData: FormData): Promise<FieldState> {
  const me = await requireManager();
  if (!me) return { error: "Not authorised" };
  const parsed = defSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid field" };
  const d = parsed.data;

  const key = slugify(d.key?.trim() || d.label);
  const clash = await db.customFieldDef.findUnique({ where: { entityType_key: { entityType: d.entityType, key } } });
  if (clash) return { error: `A field with key "${key}" already exists for this entity` };

  const count = await db.customFieldDef.count({ where: { entityType: d.entityType } });
  const def = await db.customFieldDef.create({
    data: {
      entityType: d.entityType,
      key,
      label: d.label,
      type: d.type,
      options: normalizeJson(d.options),
      required: d.required === "true" || d.required === "on",
      placeholder: d.placeholder,
      help: d.help,
      matchType: d.matchType,
      visibility: normalizeJson(d.visibility),
      active: d.active !== "false",
      order: count,
    },
  });
  await writeAudit({ userId: me.id, action: "CREATE", entity: "CustomFieldDef", entityId: def.id, summary: `Created custom field "${def.label}"` });
  revalidatePath("/settings/custom-fields");
  return undefined;
}

export async function updateCustomField(_prev: FieldState, formData: FormData): Promise<FieldState> {
  const me = await requireManager();
  if (!me) return { error: "Not authorised" };
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing id" };
  const parsed = defSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid field" };
  const d = parsed.data;

  // The key is stable once created — never rewrite it (would orphan stored values).
  await db.customFieldDef.update({
    where: { id },
    data: {
      label: d.label,
      type: d.type,
      options: normalizeJson(d.options),
      required: d.required === "true" || d.required === "on",
      placeholder: d.placeholder,
      help: d.help,
      matchType: d.matchType,
      visibility: normalizeJson(d.visibility),
      active: d.active !== "false",
    },
  });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "CustomFieldDef", entityId: id, summary: `Updated custom field "${d.label}"` });
  revalidatePath("/settings/custom-fields");
  return undefined;
}

export async function deleteCustomField(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  // deleteMany + count: a missing id is not a delete (no audit), while a real
  // DB failure propagates instead of being silently swallowed.
  const deleted = await db.customFieldDef.deleteMany({ where: { id } });
  if (deleted.count === 0) return;
  await writeAudit({ userId: me.id, action: "DELETE", entity: "CustomFieldDef", entityId: id, summary: "Deleted custom field" });
  revalidatePath("/settings/custom-fields");
}

/** Move a field up/down within its entity group; rewrites the order to 0..n-1. */
export async function moveCustomField(formData: FormData) {
  const me = await requireManager();
  if (!me) return;
  const id = String(formData.get("id") ?? "");
  const dir = String(formData.get("direction") ?? "");
  if (dir !== "up" && dir !== "down") return;

  const target = await db.customFieldDef.findUnique({ where: { id }, select: { entityType: true } });
  if (!target) return;

  const defs = await db.customFieldDef.findMany({
    where: { entityType: target.entityType },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const idx = defs.findIndex((f) => f.id === id);
  const swapIdx = dir === "up" ? idx - 1 : idx + 1;
  if (idx === -1 || swapIdx < 0 || swapIdx >= defs.length) return;

  [defs[idx], defs[swapIdx]] = [defs[swapIdx], defs[idx]];
  await db.$transaction(defs.map((f, i) => db.customFieldDef.update({ where: { id: f.id }, data: { order: i } })));
  revalidatePath("/settings/custom-fields");
}

/**
 * Set (or clear) a single custom field value on an entity. Called from the detail
 * sidebar. Agents+ only. Reads entityType/id/key/value, validates against the def,
 * merges into the entity's customFields JSON and writes it back.
 */
export async function setCustomFieldValue(formData: FormData) {
  // DB truth: role/isActive rehydrated (JWT freezes them at login).
  const me = await getCurrentUser();
  if (!me || !me.isActive || !isAgent(me.role as Role)) return;

  const entityType = String(formData.get("entityType") ?? "");
  if (!CUSTOM_FIELD_ENTITIES.includes(entityType as (typeof CUSTOM_FIELD_ENTITIES)[number])) return;
  const rawId = String(formData.get("id") ?? "");
  const entityId = Number(rawId);
  if (!Number.isFinite(entityId)) return;
  const key = String(formData.get("key") ?? "");
  if (!key) return;

  const def = await db.customFieldDef.findUnique({
    where: { entityType_key: { entityType, key } },
  });
  if (!def) return;

  const result = validateValue(def as CustomFieldDef, String(formData.get("value") ?? ""));
  if (!result.ok) return;

  // Load current JSON, apply the change, write it back.
  const loaders = {
    TICKET: () => db.ticket.findUnique({ where: { id: entityId }, select: { customFields: true } }),
    PROBLEM: () => db.problem.findUnique({ where: { id: entityId }, select: { customFields: true } }),
    CHANGE: () => db.change.findUnique({ where: { id: entityId }, select: { customFields: true } }),
  } as const;
  const row = await loaders[entityType as keyof typeof loaders]();
  if (!row) return;

  const values = parseValues(row.customFields);
  if (result.value === null) delete values[key];
  else values[key] = result.value;
  const json = JSON.stringify(values);

  if (entityType === "TICKET") await db.ticket.update({ where: { id: entityId }, data: { customFields: json } });
  else if (entityType === "PROBLEM") await db.problem.update({ where: { id: entityId }, data: { customFields: json } });
  else await db.change.update({ where: { id: entityId }, data: { customFields: json } });

  await writeAudit({
    userId: me.id, action: "UPDATE", entity: entityType, entityId,
    summary: `Set custom field "${def.label}"`,
  });
  revalidatePath(`${ENTITY_PATH[entityType]}/${entityId}`);
}
