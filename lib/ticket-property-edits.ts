/**
 * Pure rules for the ticket Properties panel: every edit is saved the moment it is
 * made, and can be taken back for a short while afterwards.
 */

/** How long the "Undo" action of a saved property edit stays available. */
export const UNDO_WINDOW_MS = 6_000;

export const PROPERTY_KEYS = [
  "status", "type", "priority", "impact", "urgency", "assigneeId", "groupId", "categoryId", "serviceId",
] as const;
export type PropertyKey = (typeof PROPERTY_KEYS)[number];
export type PropertyValues = Record<PropertyKey, string>;
export type FieldChange = { field: PropertyKey; value: string };

/** The group is saved before the assignee, so the server checks the assignee against the NEW group. */
const SAVE_RANK: Partial<Record<PropertyKey, number>> = { groupId: 0, assigneeId: 2 };
const rankOf = (field: PropertyKey) => SAVE_RANK[field] ?? 1;

const NONE = "none";

export function withChanges(values: PropertyValues, changes: readonly FieldChange[]): PropertyValues {
  return changes.reduce((next, { field, value }) => ({ ...next, [field]: value }), values);
}

/**
 * The values after one edit. Moving a ticket to a group its assignee is not a
 * member of clears the assignee, exactly as the server does when it saves the edit.
 */
export function applyPropertyEdit(
  values: PropertyValues,
  edit: FieldChange,
  groupMembers: Readonly<Record<string, readonly string[]>>,
): PropertyValues {
  const next = withChanges(values, [edit]);
  const joinsOtherGroup = edit.field === "groupId" && edit.value !== NONE && next.assigneeId !== NONE;
  if (joinsOtherGroup && !(groupMembers[edit.value] ?? []).includes(next.assigneeId)) next.assigneeId = NONE;
  return next;
}

/** The changes that turn `from` into `to`, in the order the server must apply them. Undoing an edit is `changesBetween(after, before)`. */
export function changesBetween(from: PropertyValues, to: PropertyValues): FieldChange[] {
  return PROPERTY_KEYS.filter((field) => from[field] !== to[field])
    .sort((a, b) => rankOf(a) - rankOf(b))
    .map((field) => ({ field, value: to[field] }));
}
