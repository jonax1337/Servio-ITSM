import { PRIORITIES } from "@/lib/constants";

/**
 * Multi-field bulk edit of tickets: the fields one bulk action may set, in the
 * order they are applied. Group goes before assignee because moving a ticket to
 * a group clears an assignee who is not a member, and the new assignee is then
 * checked against that group.
 */
export const BULK_FIELDS = ["groupId", "assigneeId", "categoryId", "priority", "status"] as const;
export type BulkField = (typeof BULK_FIELDS)[number];

/** Bulk status is limited to transitions that don't need a reason or note. */
export const BULK_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;

/** The value that clears an optional relation (no group, unassigned, no category). */
export const BULK_CLEAR = "none";

const CLEARABLE: readonly BulkField[] = ["groupId", "assigneeId", "categoryId"];

const ENUM_VALUES: Partial<Record<BulkField, readonly string[]>> = {
  priority: PRIORITIES,
  status: BULK_STATUSES,
};

export type BulkChange = { field: BulkField; value: string };

function isValidValue(field: BulkField, value: string): boolean {
  if (value === BULK_CLEAR) return CLEARABLE.includes(field);
  const allowed = ENUM_VALUES[field];
  return allowed ? allowed.includes(value) : true;
}

/**
 * The ordered field changes a bulk edit asks for. Fields left empty mean "don't change";
 * unknown fields and values a bulk edit may not set (a status needing a reason, an off-list
 * priority) are dropped, so a forged request cannot widen what the form offers.
 */
export function buildBulkChanges(patch: unknown): BulkChange[] {
  if (!patch || typeof patch !== "object") return [];
  const requested = patch as Record<string, unknown>;
  return BULK_FIELDS.flatMap((field) => {
    const value = requested[field];
    return typeof value === "string" && value !== "" && isValidValue(field, value) ? [{ field, value }] : [];
  });
}

export type BulkOutcome = { updated: number; failed: number; error?: string };

const ticketCount = (n: number) => `${n} ${n === 1 ? "ticket" : "tickets"}`;

/** The one-line result shown after a bulk edit, e.g. "5 tickets updated" or "3 tickets updated, 2 not changed". */
export function bulkSummary({ updated, failed }: BulkOutcome): string {
  if (failed === 0) return `${ticketCount(updated)} updated`;
  if (updated === 0) return `${ticketCount(failed)} not changed`;
  return `${ticketCount(updated)} updated, ${failed} not changed`;
}
