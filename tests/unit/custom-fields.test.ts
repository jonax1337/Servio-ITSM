import { describe, expect, it } from "vitest";
import {
  assertRequiredCustomFields,
  entityFieldValues,
  isFieldVisible,
  parseOptions,
  parseValues,
  validateValue,
  valuesOfDefs,
  type CustomFieldDef,
} from "@/lib/custom-fields";

const def = (over: Partial<CustomFieldDef> = {}): CustomFieldDef => ({
  id: "cf1",
  entityType: "TICKET",
  key: "env",
  label: "Environment",
  type: "text",
  options: "[]",
  required: false,
  placeholder: null,
  help: null,
  matchType: "ALL",
  visibility: "[]",
  order: 0,
  active: true,
  ...over,
});

describe("validateValue", () => {
  it("accepts and trims plain text", () => {
    expect(validateValue(def(), "  prod ")).toEqual({ ok: true, value: "prod" });
  });

  it("rejects a missing required value", () => {
    expect(validateValue(def({ required: true }), " ").ok).toBe(false);
  });

  it("numbers must parse", () => {
    expect(validateValue(def({ type: "number" }), "42")).toEqual({ ok: true, value: "42" });
    expect(validateValue(def({ type: "number" }), "abc").ok).toBe(false);
  });

  it("select values must be one of the options", () => {
    const d = def({ type: "select", options: '["dev","prod"]' });
    expect(validateValue(d, "prod").ok).toBe(true);
    expect(validateValue(d, "staging").ok).toBe(false);
  });

  it("dates must be parseable", () => {
    expect(validateValue(def({ type: "date" }), "2026-08-23").ok).toBe(true);
    expect(validateValue(def({ type: "date" }), "tomorrow").ok).toBe(false);
  });

  it("checkboxes normalise to true/null and are never required", () => {
    expect(validateValue(def({ type: "checkbox", required: true }), "true")).toEqual({ ok: true, value: "true" });
    expect(validateValue(def({ type: "checkbox", required: true }), "")).toEqual({ ok: true, value: null });
  });
});

describe("isFieldVisible", () => {
  it("is always visible without conditions", () => {
    expect(isFieldVisible(def(), {})).toBe(true);
  });

  it("respects ALL semantics", () => {
    const d = def({ visibility: JSON.stringify([{ field: "type", op: "eq", value: "INCIDENT" }, { field: "priority", op: "eq", value: "HIGH" }]) });
    expect(isFieldVisible(d, { type: "INCIDENT", priority: "HIGH" })).toBe(true);
    expect(isFieldVisible(d, { type: "INCIDENT", priority: "LOW" })).toBe(false);
  });

  it("respects ANY semantics", () => {
    const d = def({ matchType: "ANY", visibility: JSON.stringify([{ field: "type", op: "eq", value: "INCIDENT" }, { field: "priority", op: "eq", value: "HIGH" }]) });
    expect(isFieldVisible(d, { type: "REQUEST", priority: "HIGH" })).toBe(true);
  });

  it("inactive defs are never visible", () => {
    expect(isFieldVisible(def({ active: false }), {})).toBe(false);
  });

  it("supports empty/not_empty operators", () => {
    const d = def({ visibility: JSON.stringify([{ field: "categoryId", op: "not_empty", value: "" }]) });
    expect(isFieldVisible(d, { categoryId: "c1" })).toBe(true);
    expect(isFieldVisible(d, { categoryId: null })).toBe(false);
  });
});

describe("assertRequiredCustomFields", () => {
  it("passes when every required visible field has a value", () => {
    const defs = [def({ required: true })];
    expect(assertRequiredCustomFields(defs, { env: "prod" })).toEqual({ ok: true });
  });

  it("names the missing required fields", () => {
    const defs = [def({ required: true }), def({ key: "dept", label: "Department", required: true })];
    const res = assertRequiredCustomFields(defs, { env: "" });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.missing).toEqual(["Environment", "Department"]);
      expect(res.error).toContain("required");
    }
  });

  it("skips required fields hidden by their visibility conditions", () => {
    const defs = [def({ required: true, visibility: JSON.stringify([{ field: "type", op: "eq", value: "INCIDENT" }]) })];
    expect(assertRequiredCustomFields(defs, {}, { type: "REQUEST" }).ok).toBe(true);
    expect(assertRequiredCustomFields(defs, {}, { type: "INCIDENT" }).ok).toBe(false);
  });

  it("never enforces checkboxes", () => {
    const defs = [def({ type: "checkbox", required: true })];
    expect(assertRequiredCustomFields(defs, {}).ok).toBe(true);
  });
});

describe("parseValues / entityFieldValues / parseOptions", () => {
  it("parses a customFields JSON blob into strings", () => {
    expect(parseValues('{"a":"1","b":2,"c":null}')).toEqual({ a: "1", b: "2" });
  });

  it("tolerates garbage", () => {
    expect(parseValues("not json")).toEqual({});
    expect(parseValues(null)).toEqual({});
  });

  it("flattens built-in entity values for visibility checks", () => {
    const out = entityFieldValues({ type: "INCIDENT", categoryId: null, createdAt: new Date(0) });
    expect(out.type).toBe("INCIDENT");
    expect(out.categoryId).toBeNull();
    expect(out.createdAt).toBeUndefined(); // objects (dates) are skipped
  });

  it("parses select options", () => {
    expect(parseOptions('["a","b"]')).toEqual(["a", "b"]);
    expect(parseOptions("[]")).toEqual([]);
    expect(parseOptions(null)).toEqual([]);
  });
});

describe("valuesOfDefs", () => {
  const defs = [def({ key: "env" }), def({ id: "cf2", key: "owner" })];

  it("keeps the values of known fields and drops empty ones", () => {
    expect(valuesOfDefs(defs, { env: "prod", owner: "" })).toEqual({ env: "prod" });
  });

  it("drops keys that no field defines", () => {
    expect(valuesOfDefs(defs, { env: "prod", __proto__x: "1", other: "2" })).toEqual({ env: "prod" });
  });
});
