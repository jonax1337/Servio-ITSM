/** The `{ ok, error }` result convention used by actions that report failures to the UI. */
export type ActionResult = { ok: boolean; error?: string };

/**
 * Narrow an action's return value to the result convention. Actions that return
 * nothing (or anything else) yield `null`, so callers only report what an action
 * explicitly said.
 */
export function readActionResult(value: unknown): ActionResult | null {
  if (!value || typeof value !== "object" || !("ok" in value)) return null;
  const { ok, error } = value as { ok: unknown; error?: unknown };
  if (typeof ok !== "boolean") return null;
  return typeof error === "string" ? { ok, error } : { ok };
}
