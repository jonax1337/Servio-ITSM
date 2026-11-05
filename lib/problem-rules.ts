/**
 * Pure lifecycle rules for problems: the documentation a status requires, the
 * read-only lock on closed problems and the resolved-date bookkeeping.
 * Kept free of I/O so server actions and tests share one definition.
 */

export type ProblemTexts = { rootCause: string | null; workaround: string | null };

const isBlank = (value: string | null | undefined) => !value || value.trim() === "";

export const KNOWN_ERROR_NEEDS_WORKAROUND = "A known error needs a documented workaround.";
export const RESOLVED_NEEDS_ROOT_CAUSE = "A resolved problem needs a documented root cause.";

/** The one text field each status depends on, with the refusal shown when it is blank. */
const REQUIRED_TEXT: Readonly<Record<string, { field: keyof ProblemTexts; message: string }>> = {
  KNOWN_ERROR: { field: "workaround", message: KNOWN_ERROR_NEEDS_WORKAROUND },
  RESOLVED: { field: "rootCause", message: RESOLVED_NEEDS_ROOT_CAUSE },
};

/**
 * The refusal when `status` requires documentation the problem lacks, else `null`.
 * Checked on a transition (with the target status) and on create.
 */
export function statusRequirementError(status: string, texts: ProblemTexts): string | null {
  const required = REQUIRED_TEXT[status];
  return required && isBlank(texts[required.field]) ? required.message : null;
}

/**
 * The refusal for setting `field` to `value` while the problem is in `status`, else `null`.
 * Only blanking the field the status depends on is refused, so a legacy problem that
 * lacks the other text can still be documented.
 */
export function textEditError(status: string, field: keyof ProblemTexts, value: string | null): string | null {
  const required = REQUIRED_TEXT[status];
  return required?.field === field && isBlank(value) ? required.message : null;
}

/** Fields that become read-only once a problem is closed. Comments, links, assignment and status stay editable. */
const FIELDS_LOCKED_WHEN_CLOSED: ReadonlySet<string> = new Set([
  "title", "description", "rootCause", "workaround", "priority", "impact", "categoryId",
]);

export const PROBLEM_LOCKED_MESSAGE = "This problem is closed. Reopen it to edit this field.";

export const isProblemLocked = (status: string) => status === "CLOSED";

/** The refusal for editing `field` of a problem in `status`, else `null`. */
export function fieldLockError(status: string, field: string): string | null {
  return isProblemLocked(status) && FIELDS_LOCKED_WHEN_CLOSED.has(field) ? PROBLEM_LOCKED_MESSAGE : null;
}

/**
 * The `resolvedAt` change for a move to `target`: stamped on RESOLVED, kept on CLOSED
 * when already set (closing a resolved problem must not rewrite when it was resolved;
 * closing straight from active work stamps it, since the problem ends there), cleared
 * when the problem goes back to active work.
 */
export function resolvedAtPatch(target: string, now: Date, current: Date | null): { resolvedAt?: Date | null } {
  if (target === "RESOLVED") return { resolvedAt: now };
  if (target === "CLOSED") return current ? {} : { resolvedAt: now };
  return { resolvedAt: null };
}
