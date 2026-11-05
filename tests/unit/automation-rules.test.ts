import { describe, expect, it } from "vitest";
import { parseRule, referencedIds } from "@/lib/automation-rules";

const json = (v: unknown) => JSON.stringify(v);
const parse = (conditions: unknown[], actions: unknown[]) => parseRule(json(conditions), json(actions));

function errorsOf(result: ReturnType<typeof parseRule>) {
  if (result.ok) throw new Error("expected the rule to be rejected");
  return result.errors;
}

describe("parseRule actions", () => {
  it("accepts valued actions and actions that take no value", () => {
    const result = parse([], [
      { type: "set_status", value: "OPEN" },
      { type: "set_priority", value: "HIGH" },
      { type: "assign", value: "user-1" },
      { type: "set_group", value: "group-1" },
      { type: "notify", value: "user-2" },
      { type: "webhook", value: "https://example.com/hook" },
      { type: "internal_note", value: "Escalated" },
      { type: "escalate" },
      { type: "major_incident" },
      { type: "notify_group" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("rejects a status or priority outside the allowed values", () => {
    const errors = errorsOf(parse([], [
      { type: "set_status", value: "NOPE" },
      { type: "set_priority", value: "" },
    ])).actions;
    expect(errors).toEqual([
      "Action 1 (Set status): choose a valid status.",
      "Action 2 (Set priority): choose a valid priority.",
    ]);
  });

  it.each([
    ["assign", "choose an agent."],
    ["notify", "choose an agent."],
    ["set_group", "choose a group."],
    ["internal_note", "enter the note text."],
  ])("requires a value for %s", (type, message) => {
    for (const value of [undefined, "", "   "]) {
      const errors = errorsOf(parse([], [{ type, value }])).actions;
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(message);
    }
  });

  it.each(["not a url", "ftp://example.com/x", "javascript:alert(1)", ""])("rejects webhook target %j", (value) => {
    expect(errorsOf(parse([], [{ type: "webhook", value }])).actions[0]).toContain("valid http(s) URL");
  });

  it("rejects an unknown action type", () => {
    expect(errorsOf(parse([], [{ type: "delete_ticket" }])).actions).toEqual(["Action 1: choose an action."]);
  });

  it("requires at least one action", () => {
    expect(errorsOf(parse([], [])).actions).toEqual(["Add at least one action."]);
  });

  it("trims values it keeps", () => {
    const result = parse([], [{ type: "internal_note", value: "  hello  " }]);
    expect(result).toMatchObject({ ok: true, actions: [{ type: "internal_note", value: "hello" }] });
  });
});

describe("parseRule conditions", () => {
  const action = { type: "escalate" };

  it("allows a rule with no conditions", () => {
    expect(parse([], [action])).toMatchObject({ ok: true, conditions: [] });
  });

  it("requires a value unless the operator is empty / not_empty", () => {
    expect(parse([{ field: "priority", op: "empty" }, { field: "title", op: "not_empty", value: "" }], [action]).ok).toBe(true);
    expect(errorsOf(parse([{ field: "priority", op: "eq", value: "" }], [action])).conditions).toEqual([
      "Condition 1: enter a value.",
    ]);
  });

  it("rejects unknown fields and operators", () => {
    const errors = errorsOf(parse([
      { field: "nope", op: "eq", value: "x" },
      { field: "title", op: "regex", value: "x" },
    ], [action])).conditions;
    expect(errors).toEqual(["Condition 1: choose a field.", "Condition 2: choose an operator."]);
  });
});

describe("parseRule malformed input", () => {
  it("reports unreadable JSON for both lists", () => {
    const errors = errorsOf(parseRule("{", "nope"));
    expect(errors.conditions).toEqual(["The Condition list could not be read."]);
    expect(errors.actions).toEqual(["The Action list could not be read."]);
  });

  it("reports entries that are not objects with the expected fields", () => {
    const errors = errorsOf(parse(["x"], [{ value: "y" }]));
    expect(errors.conditions).toEqual(["Condition 1 is malformed."]);
    expect(errors.actions).toEqual(["Action 1 is malformed."]);
  });
});

describe("referencedIds", () => {
  it("splits agent and group references and ignores valueless actions", () => {
    const ids = referencedIds([
      { type: "assign", value: "u1" },
      { type: "notify", value: "u2" },
      { type: "set_group", value: "g1" },
      { type: "set_priority", value: "HIGH" },
      { type: "escalate" },
    ]);
    expect(ids).toEqual({ agentIds: ["u1", "u2"], groupIds: ["g1"] });
  });
});
