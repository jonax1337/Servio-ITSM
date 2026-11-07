/**
 * The ticket and asset bodies of /api/v1 were defined in camelCase
 * (`assigneeId`), while every response and the newer ITSM bodies are
 * snake_case (`assignee_id`). Those endpoints accept both: top-level
 * snake_case keys are translated before validation. Sending one field in both
 * spellings with different values is ambiguous and refused.
 */

const snakeToCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export type CamelizedBody = { body: unknown } | { conflict: string[] };

export function camelizeBody(body: unknown): CamelizedBody {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { body };
  const out: Record<string, unknown> = {};
  const conflicts: string[] = [];
  const entries = Object.entries(body as Record<string, unknown>);
  // camelCase keys first, so a snake_case twin can be compared against them.
  for (const [key, value] of entries) if (!key.includes("_")) out[key] = value;
  for (const [key, value] of entries) {
    if (!key.includes("_")) continue;
    const camel = snakeToCamel(key);
    if (camel in out && JSON.stringify(out[camel]) !== JSON.stringify(value)) conflicts.push(`${key} / ${camel}`);
    else out[camel] = value;
  }
  return conflicts.length ? { conflict: conflicts } : { body: out };
}
