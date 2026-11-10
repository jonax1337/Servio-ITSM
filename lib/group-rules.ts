/**
 * Rules for deleting a group through the API. Pure and DB-free, so the contract is unit-testable;
 * the counting queries live in lib/group-references.ts.
 *
 * A group is the routing target of a lot of configuration (categories, services, catalog items and
 * their visibility, schedules, automations). Deleting it from the console quietly clears those
 * links; for an integration that is a trap, so the API refuses while anything still points at the
 * group and says what.
 */

/** Statuses after which a problem, change, release or asset no longer needs its team. */
export const FINISHED_PROBLEM_STATUSES = ["RESOLVED", "CLOSED"] as const;
export const FINISHED_CHANGE_STATUSES = ["CLOSED", "REJECTED", "FAILED", "CANCELLED"] as const;
export const FINISHED_RELEASE_STATUSES = ["DEPLOYED", "CANCELLED"] as const;
export const FINISHED_ASSET_STATUSES = ["RETIRED", "DISPOSED"] as const;

export const GROUP_IN_USE_CODE = "GROUP_IN_USE";

/** What still points at a group, by kind; only kinds with at least one entry are listed. */
export type GroupReferences = Partial<Record<string, number>>;

/** Drops the kinds that count nothing, so an empty result means "safe to delete". */
export function nonEmptyReferences(counts: Record<string, number>): GroupReferences {
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}

/** The refusal for a group that is still referenced; null when it is safe to delete. */
export function groupInUseRefusal(references: GroupReferences) {
  if (Object.keys(references).length === 0) return null;
  return {
    message: "The group is still referenced. Point those records at another group (or clear their group), then delete it.",
    code: GROUP_IN_USE_CODE,
    references,
    hint:
      "Nothing is removed automatically. Closed tickets, problems and changes are not counted: they keep their row and lose the group. " +
      "To retire a group without deleting it, remove its members and rename it.",
  };
}
