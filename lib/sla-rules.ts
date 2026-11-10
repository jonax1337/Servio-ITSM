/**
 * Rules for deleting an SLA or a business calendar through the API. Pure and DB-free, so the contract
 * is unit-testable; the counting queries live in lib/sla-references.ts.
 *
 * The console's delete buttons detach the record first and delete it anyway. For an integration that
 * would silently move tickets and services to "no SLA" (or SLAs to a 24/7 clock), so the API refuses
 * while anything still points at the record and says what.
 */

/** What still points at a record, by kind; only kinds with at least one entry are listed. */
export type References = Partial<Record<string, number>>;

/** Drops the kinds that count nothing, so an empty result means "safe to delete". */
export function nonEmptyReferences(counts: Record<string, number>): References {
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}

export const SLA_IN_USE_CODE = "SLA_IN_USE";
export const CALENDAR_IN_USE_CODE = "CALENDAR_IN_USE";

const SLA_HINT =
  "Nothing is removed automatically. Tickets keep the deadlines already stamped on them. " +
  "To stop using an SLA without deleting it, set is_active to false; to move services to another SLA, change their sla_id.";
const CALENDAR_HINT =
  "Nothing is removed automatically. To stop using a calendar, point its SLAs at another calendar (or null for a 24/7 clock) first.";

function refusal(subject: string, code: string, references: References, advice: string, hint: string) {
  if (Object.keys(references).length === 0) return null;
  return { message: `The ${subject} is still referenced. ${advice}`, code, references, hint };
}

/** The refusal for an SLA that is still referenced; null when it is safe to delete. */
export function slaInUseRefusal(references: References) {
  return refusal("SLA", SLA_IN_USE_CODE, references, "Point those records at another SLA, then delete it.", SLA_HINT);
}

/** The refusal for a business calendar that is still referenced; null when it is safe to delete. */
export function calendarInUseRefusal(references: References) {
  return refusal("business calendar", CALENDAR_IN_USE_CODE, references, "Point those SLAs at another calendar, then delete it.", CALENDAR_HINT);
}
