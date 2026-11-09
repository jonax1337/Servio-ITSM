/**
 * Helpers of the API endpoints that write only what changed (PATCH and the
 * upserts by origin reference): an unchanged body writes nothing and no audit
 * row, and `meta.changed` names what did change in the API's field names.
 * Pure and DB-free, so the contract is unit-testable.
 */

/** The columns of `data` whose value differs from `current`. Dates compare by instant, everything else by value. */
export function changedColumns(current: Record<string, unknown>, data: Record<string, unknown>): string[] {
  const norm = (x: unknown) => (x instanceof Date ? x.toISOString() : (x ?? null));
  return Object.keys(data).filter((k) => norm(current[k]) !== norm(data[k]));
}

/**
 * Column names (camelCase, as written) as the API's field names. `renames` covers
 * columns whose field is named differently (e.g. `isActive` → `active`).
 */
export function apiFieldNames(columns: string[], renames: Record<string, string> = {}): string[] {
  return columns.map((c) => renames[c] ?? c.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`));
}
