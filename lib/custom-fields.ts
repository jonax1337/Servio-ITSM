// Shared, client-safe definitions & helpers for admin-defined custom fields.
// Imported by both Server Components / actions and client components, so it must
// not pull in server-only modules (db, session, etc.).

import { parseJson, type Condition } from "@/lib/automation-defs";

// The control types a field can render as.
export const CUSTOM_FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "select",
  "date",
  "checkbox",
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  textarea: "Long text",
  number: "Number",
  select: "Dropdown",
  date: "Date",
  checkbox: "Checkbox",
};

// Entities that can carry custom fields (mirrors the schema comment).
export const CUSTOM_FIELD_ENTITIES = ["TICKET", "PROBLEM", "CHANGE"] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];
export const CUSTOM_FIELD_ENTITY_LABELS: Record<CustomFieldEntity, string> = {
  TICKET: "Tickets",
  PROBLEM: "Problems",
  CHANGE: "Changes",
};

/** Built-in fields that visibility conditions can be evaluated against, per entity. */
export const VISIBILITY_FIELDS: Record<CustomFieldEntity, { value: string; label: string }[]> = {
  TICKET: [
    { value: "type", label: "Type" },
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "impact", label: "Impact" },
    { value: "urgency", label: "Urgency" },
    { value: "source", label: "Source" },
    { value: "categoryId", label: "Category" },
  ],
  PROBLEM: [
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "categoryId", label: "Category" },
  ],
  CHANGE: [
    { value: "type", label: "Type" },
    { value: "status", label: "Status" },
    { value: "priority", label: "Priority" },
    { value: "risk", label: "Risk" },
  ],
};

/** TS mirror of the CustomFieldDef Prisma model. */
export type CustomFieldDef = {
  id: string;
  entityType: string;
  key: string;
  label: string;
  type: string;
  options: string; // JSON array of choice strings
  required: boolean;
  placeholder: string | null;
  help: string | null;
  matchType: string; // ALL | ANY
  visibility: string; // JSON array of {field,op,value}
  order: number;
  active: boolean;
};

/** Parse a def's `options` JSON into a list of choice strings. */
export function parseOptions(s: string | null | undefined): string[] {
  const arr = parseJson<unknown[]>(s ?? "[]", []);
  return arr.filter((x): x is string => typeof x === "string");
}

/** Parse a def's `visibility` JSON into automation-shaped conditions. */
export function parseConditions(s: string | null | undefined): Condition[] {
  const arr = parseJson<Condition[]>(s ?? "[]", []);
  return arr.filter((c) => c && typeof c.field === "string" && typeof c.op === "string");
}

// The tiny condition evaluator — same semantics as lib/automations.ts evalCondition,
// but run against a flat record of the entity's built-in field values.
function evalCondition(values: Record<string, string | null>, c: Condition): boolean {
  const v = values[c.field] ?? null;
  const target = c.value ?? "";
  switch (c.op) {
    case "eq": return (v ?? "") === target;
    case "ne": return (v ?? "") !== target;
    case "contains": return (v ?? "").toLowerCase().includes(target.toLowerCase());
    case "empty": return !v;
    case "not_empty": return !!v;
    default: return false;
  }
}

/**
 * Whether a field is visible for an entity given its built-in field values.
 * No conditions ⇒ always visible. `matchType` decides ALL vs ANY.
 */
export function isFieldVisible(def: CustomFieldDef, entityValues: Record<string, string | null>): boolean {
  if (!def.active) return false;
  const conds = parseConditions(def.visibility);
  if (conds.length === 0) return true;
  return def.matchType === "ANY"
    ? conds.some((c) => evalCondition(entityValues, c))
    : conds.every((c) => evalCondition(entityValues, c));
}

export type ValidateResult = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Validate & normalise a raw string value for a def. Returns the canonical
 * string to store (or null to clear it) — checkboxes store "true"/"" and are
 * never "required" in the presence sense.
 */
export function validateValue(def: CustomFieldDef, raw: string | null | undefined): ValidateResult {
  const value = (raw ?? "").trim();
  const type = def.type as CustomFieldType;

  if (type === "checkbox") {
    return { ok: true, value: value === "true" || value === "on" ? "true" : null };
  }

  if (!value) {
    if (def.required) return { ok: false, error: `${def.label} is required` };
    return { ok: true, value: null };
  }

  switch (type) {
    case "number":
      if (Number.isNaN(Number(value))) return { ok: false, error: `${def.label} must be a number` };
      return { ok: true, value };
    case "select": {
      const opts = parseOptions(def.options);
      if (opts.length > 0 && !opts.includes(value))
        return { ok: false, error: `${def.label} has an invalid choice` };
      return { ok: true, value };
    }
    case "date": {
      if (Number.isNaN(Date.parse(value))) return { ok: false, error: `${def.label} must be a valid date` };
      return { ok: true, value };
    }
    default:
      return { ok: true, value };
  }
}

/**
 * Enforce that every REQUIRED, currently-VISIBLE custom field for an entity has a
 * value. Pure + client-safe (no db): the caller loads the active defs for the
 * entity type and passes the submitted values plus the entity's built-in field
 * values (so a required field hidden by its visibility conditions isn't enforced).
 *
 * Returns `{ ok: true }` when satisfied, or `{ ok: false, error, missing }` naming
 * the first missing field — mirroring {@link validateValue}'s message style so
 * callers can surface it or abort.
 */
export function assertRequiredCustomFields(
  defs: CustomFieldDef[],
  values: Record<string, string | null | undefined>,
  entityValues: Record<string, string | null> = {},
): { ok: true } | { ok: false; error: string; missing: string[] } {
  const missing: string[] = [];
  for (const def of defs) {
    // Checkboxes are never "required" in the presence sense (see validateValue).
    if (!def.required || def.active === false || def.type === "checkbox") continue;
    if (!isFieldVisible(def, entityValues)) continue;
    const raw = values[def.key];
    if (raw == null || String(raw).trim() === "") missing.push(def.label);
  }
  if (missing.length === 0) return { ok: true };
  return { ok: false, error: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required`, missing };
}

/** The submitted values that belong to one of `defs`, so a forged key never reaches the stored JSON. */
export function valuesOfDefs(defs: readonly CustomFieldDef[], values: Record<string, string>): Record<string, string> {
  const known = new Set(defs.map((def) => def.key));
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => known.has(key) && value !== ""));
}

/** Coerce a stored customFields JSON blob into a flat string->string record. */
export function parseValues(s: string | null | undefined): Record<string, string> {
  const obj = parseJson<Record<string, unknown>>(s ?? "{}", {});
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) if (v != null) out[k] = String(v);
  return out;
}

/** Build the flat record of built-in values a visibility check runs against. */
export function entityFieldValues(entity: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of Object.keys(entity)) {
    const v = entity[k];
    if (v == null) out[k] = null;
    else if (typeof v === "object") continue; // skip relations/dates objects
    else out[k] = String(v);
  }
  return out;
}
