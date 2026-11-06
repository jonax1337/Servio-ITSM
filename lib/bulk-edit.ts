import { PRIORITIES } from "@/lib/constants";
import { ASSIGNEE_NOT_IN_GROUP, NOT_YOUR_TICKET } from "@/lib/ticket-refusals";

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

/** What a bulk edit does to one ticket's access, membership and status rules; the server fills it from the database. */
export type BulkRules = {
  /** Whether the actor may change a ticket in this state. */
  canAct(state: BulkTicketState): boolean;
  isMember(groupId: string, userId: string): boolean;
  /** Why the ticket may not move to `to` (approval, merge, workflow), or null. */
  statusRefusal(state: BulkTicketState, to: string): string | null;
};

export type BulkTicketState = {
  status: string;
  groupId: string | null;
  assigneeId: string | null;
  approvalState: string | null;
  mergedIntoId: number | null;
};

/**
 * Why a ticket would refuse the whole patch, or null when every change would apply.
 * Walks the changes in application order on a copy of the ticket, with the same checks
 * the single-field edit makes before each write, so a ticket is rarely changed halfway:
 * moving it to a group the actor cannot act in fails the fields that follow. Checks cannot
 * foresee what automations do between the writes, hence {@link BulkOutcome.partial}.
 */
export function planBulkTicket(ticket: BulkTicketState, changes: readonly BulkChange[], rules: BulkRules): string | null {
  const state = { ...ticket };
  for (const { field, value } of changes) {
    if (!rules.canAct(state)) return NOT_YOUR_TICKET;
    const target = value === BULK_CLEAR ? null : value;
    if (field === "groupId") {
      state.groupId = target;
      if (target && state.assigneeId && !rules.isMember(target, state.assigneeId)) state.assigneeId = null;
    } else if (field === "assigneeId") {
      if (target && state.groupId && !rules.isMember(state.groupId, target)) return ASSIGNEE_NOT_IN_GROUP;
      state.assigneeId = target;
    } else if (field === "status") {
      const refusal = rules.statusRefusal(state, value);
      if (refusal) return refusal;
      state.status = value;
    }
  }
  return null;
}

/** A ticket a bulk edit did not fully change, with the reason a change was refused. */
export type BulkSkip = { ticket: string; reason: string };

/**
 * What a bulk edit did, per ticket: `updated` took every change, `skipped` took none, and
 * `partial` took some before a later change was refused (automations can re-route a ticket
 * between two writes), so those tickets differ from both before and after.
 */
export type BulkOutcome = { updated: number; partial: BulkSkip[]; skipped: BulkSkip[] };

/** What running the changes on one ticket did: how many were written, and the refusal that stopped the rest. */
export type BulkApplyResult = { applied: number; refusal: string | null };

/** `outcome` with one more ticket counted under what `result` says happened to it. */
export function withApplyResult(outcome: BulkOutcome, ticket: string, { applied, refusal }: BulkApplyResult): BulkOutcome {
  if (refusal === null) return { ...outcome, updated: outcome.updated + 1 };
  const entry = { ticket, reason: refusal };
  return applied > 0
    ? { ...outcome, partial: [...outcome.partial, entry] }
    : { ...outcome, skipped: [...outcome.skipped, entry] };
}

const ticketCount = (n: number) => `${n} ${n === 1 ? "ticket" : "tickets"}`;

/**
 * The one-line result shown after a bulk edit, e.g. "5 tickets updated" or
 * "3 tickets updated, 1 partially updated, 2 skipped". The first figure names the tickets.
 */
export function bulkSummary({ updated, partial, skipped }: BulkOutcome): string {
  const figures = [
    [updated, "updated"],
    [partial.length, "partially updated"],
    [skipped.length, "skipped"],
  ] as const;
  const shown = figures.filter(([count]) => count > 0);
  if (shown.length === 0) return `${ticketCount(0)} updated`;
  return shown.map(([count, what], i) => `${i === 0 ? ticketCount(count) : count} ${what}`).join(", ");
}

const SHOWN_REASONS = 3;
const SHOWN_TICKETS = 3;

/** Why tickets were refused, grouped by reason: "Reason (T-1, T-2 and 4 more); Other reason (T-9)". */
export function bulkSkipDetail(skipped: readonly BulkSkip[]): string {
  const byReason = new Map<string, string[]>();
  for (const { ticket, reason } of skipped) byReason.set(reason, [...(byReason.get(reason) ?? []), ticket]);
  const shown = [...byReason].slice(0, SHOWN_REASONS).map(([reason, tickets]) => {
    const more = tickets.length - SHOWN_TICKETS;
    const list = tickets.slice(0, SHOWN_TICKETS).join(", ");
    return `${reason} (${more > 0 ? `${list} and ${more} more` : list})`;
  });
  const hidden = byReason.size - SHOWN_REASONS;
  return hidden > 0 ? `${shown.join("; ")}; and ${hidden} more ${hidden === 1 ? "reason" : "reasons"}` : shown.join("; ");
}

/** The detail line under the summary: the partly updated tickets first, since they changed and need a look. */
export function bulkOutcomeDetail({ partial, skipped }: BulkOutcome): string {
  return [
    partial.length > 0 && `Partly updated: ${bulkSkipDetail(partial)}`,
    skipped.length > 0 && `Skipped: ${bulkSkipDetail(skipped)}`,
  ].filter(Boolean).join(". ");
}
