import { createHash } from "node:crypto";

/** JSON with object keys sorted at every level, so equal values serialise identically. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A stable hash of an operation and its (already canonical) args. */
export function signOperation(operationId: string, canonicalArgs: unknown): string {
  return createHash("sha256").update(`${operationId}\n${stableStringify(canonicalArgs)}`).digest("hex");
}
