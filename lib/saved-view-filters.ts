/** Filter params a saved view may carry, per entity. */
export const SAVED_VIEW_KEYS: Record<string, readonly string[]> = {
  ticket: ["q", "status", "priority", "type", "group", "assignee", "category", "service", "sla"],
  problem: ["q", "status", "priority", "group", "assignee", "category"],
  change: ["q", "status", "risk", "type", "group", "assignee"],
  asset: ["q", "type", "status", "owner", "group"],
};

/** Keep only known keys with short string values → a safe JSON to store. */
export function sanitizeFilters(raw: string, entity: string): string {
  const allowed = SAVED_VIEW_KEYS[entity] ?? SAVED_VIEW_KEYS.ticket;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    parsed = {};
  }
  const clean: Record<string, string> = {};
  for (const k of allowed) {
    const v = parsed[k];
    if (typeof v === "string" && v.trim() && v !== "all") clean[k] = v.slice(0, 120);
  }
  return JSON.stringify(clean);
}
