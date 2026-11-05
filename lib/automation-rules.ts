import { z } from "zod";
import {
  ACTION_TYPES,
  CONDITION_FIELDS,
  OPERATORS,
  type AutomationAction,
  type Condition,
} from "@/lib/automation-defs";
import { PRIORITIES, TICKET_STATUSES } from "@/lib/constants";

/** Server-side validation of an automation rule's conditions and actions. */

export type RuleErrors = { conditions: string[]; actions: string[] };

export type ParsedRule =
  | { ok: true; conditions: Condition[]; actions: AutomationAction[] }
  | { ok: false; errors: RuleErrors };

const NO_VALUE_OPERATORS: readonly string[] = ["empty", "not_empty"];

const conditionShape = z.object({
  field: z.string(),
  op: z.string(),
  value: z.string().optional(),
});
const actionShape = z.object({ type: z.string(), value: z.string().optional() });

const labelOf = (list: readonly { value: string; label: string }[], value: string) =>
  list.find((o) => o.value === value)?.label ?? value;

const isMember = (list: readonly string[], v: string) => list.includes(v);

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** Returns the problem with the value of one action, or null when it is fine. */
function actionValueError(type: string, value: string): string | null {
  switch (type) {
    case "set_status":
      return isMember(TICKET_STATUSES, value) ? null : "choose a valid status.";
    case "set_priority":
      return isMember(PRIORITIES, value) ? null : "choose a valid priority.";
    case "assign":
    case "notify":
      return value ? null : "choose an agent.";
    case "set_group":
      return value ? null : "choose a group.";
    case "internal_note":
      return value ? null : "enter the note text.";
    case "webhook":
      return isHttpUrl(value) ? null : "enter a valid http(s) URL.";
    default:
      return null; // escalate, major_incident, notify_group take no value
  }
}

function conditionError(c: Condition): string | null {
  if (!CONDITION_FIELDS.some((f) => f.value === c.field)) return "choose a field.";
  if (!OPERATORS.some((o) => o.value === c.op)) return "choose an operator.";
  if (!NO_VALUE_OPERATORS.includes(c.op) && !c.value) return "enter a value.";
  return null;
}

function parseList<T>(json: string, shape: z.ZodType<T>, noun: string): { items: T[]; errors: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { items: [], errors: [`The ${noun} list could not be read.`] };
  }
  if (!Array.isArray(raw)) return { items: [], errors: [`The ${noun} list could not be read.`] };
  const items: T[] = [];
  const errors: string[] = [];
  raw.forEach((entry, i) => {
    const parsed = shape.safeParse(entry);
    if (parsed.success) items.push(parsed.data);
    else errors.push(`${noun} ${i + 1} is malformed.`);
  });
  return { items, errors };
}

const trimmed = (value: string | undefined) => value?.trim() ?? "";

/**
 * Parses the JSON lists posted by the rule form and checks that every action
 * that needs a value has a usable one. A rule without conditions is valid (it
 * runs on every matching trigger); a rule without actions is not.
 */
export function parseRule(conditionsJson: string, actionsJson: string): ParsedRule {
  const parsedConditions = parseList(conditionsJson, conditionShape, "Condition");
  const parsedActions = parseList(actionsJson, actionShape, "Action");

  const conditions: Condition[] = parsedConditions.items.map((c) => ({ ...c, value: trimmed(c.value) }));
  const actions: AutomationAction[] = parsedActions.items.map((a) => ({ type: a.type, value: trimmed(a.value) }));

  const errors: RuleErrors = { conditions: parsedConditions.errors, actions: parsedActions.errors };
  conditions.forEach((c, i) => {
    const problem = conditionError(c);
    if (problem) errors.conditions.push(`Condition ${i + 1}: ${problem}`);
  });
  actions.forEach((a, i) => {
    if (!ACTION_TYPES.some((t) => t.value === a.type)) {
      errors.actions.push(`Action ${i + 1}: choose an action.`);
      return;
    }
    const problem = actionValueError(a.type, a.value ?? "");
    if (problem) errors.actions.push(`Action ${i + 1} (${labelOf(ACTION_TYPES, a.type)}): ${problem}`);
  });
  if (actions.length === 0 && errors.actions.length === 0) errors.actions.push("Add at least one action.");

  if (errors.conditions.length > 0 || errors.actions.length > 0) return { ok: false, errors };
  return { ok: true, conditions, actions };
}

/** Ids an action list points at, split by what they must resolve to. */
export function referencedIds(actions: readonly AutomationAction[]): { agentIds: string[]; groupIds: string[] } {
  const ids = (types: readonly string[]) =>
    actions.filter((a) => types.includes(a.type) && a.value).map((a) => a.value as string);
  return { agentIds: ids(["assign", "notify"]), groupIds: ids(["set_group"]) };
}
