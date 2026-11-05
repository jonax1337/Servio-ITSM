import { renderMarkdown } from "@/lib/markdown";
import type { AiOpResult } from "./types";

export const ok = (summary: string, data?: unknown): AiOpResult => ({ ok: true, summary, data });
export const err = (error: string): AiOpResult => ({ ok: false, error });

/**
 * The record actions Sable reuses return silently when a rule refuses a change
 * (configured workflow, role, approval gate). Compare the value read back after
 * the write with the requested one so a refused write is never reported as applied.
 * "none" means "clear the field".
 */
export function verifyFieldWrite(stored: unknown, requested: string, success: string): AiOpResult {
  const want = requested === "none" ? "" : requested;
  if (String(stored ?? "") === want) return ok(success);
  return err("Not applied — the change was refused (workflow rule, your role, or a pending approval). Nothing was changed.");
}

/** Heuristic: does this text already contain HTML tags (vs markdown / plain)? */
export function looksLikeHtml(s: string): boolean {
  return /<\/?(p|div|ul|ol|li|h[1-6]|pre|code|blockquote|strong|em|a|br|table)\b/i.test(s);
}

/**
 * Convert AI-authored rich text (markdown, or occasionally HTML) into sanitised
 * HTML for a rich-text field — a comment's `bodyHtml`, a record's `descriptionHtml`
 * twin, etc. Without this the model's markdown (paragraphs, line breaks, lists)
 * collapses into a wall of text when rendered as HTML. Returns null for empty input.
 */
export function richHtml(text: unknown): string | null {
  const s = String(text ?? "").trim();
  if (!s) return null;
  return renderMarkdown(s, looksLikeHtml(s) ? "html" : "markdown");
}

/** Validate a value against an enum set (case-insensitive, upper-cased) or return null. */
export function coerceEnum(value: unknown, allowed: readonly string[]): string | null {
  const up = String(value ?? "").trim().toUpperCase();
  return allowed.includes(up) ? up : null;
}

/**
 * Build a FormData from a plain object so we can reuse the app's existing
 * (non-redirecting) FormData server actions from an operation's `run`. Booleans
 * become "on"/"" by default (the checkbox convention most actions use); pass a
 * string ("true"/"false") explicitly when an action reads the literal value.
 * Undefined/null are skipped.
 */
export function toFormData(obj: Record<string, unknown>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    fd.set(k, typeof v === "boolean" ? (v ? "on" : "") : String(v));
  }
  return fd;
}

/** Narrow a possibly-undefined optional string arg to a trimmed string or undefined. */
export function str(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

/**
 * Parse a human record ref ("PRB-0019", "prb-19", or a bare "19") to its number.
 * A ref carrying a prefix outside `prefixes` is rejected, so a CHG ref can never
 * be mistaken for a problem. Returns null when no valid number is present.
 */
export function parseRecordNumber(ref: unknown, prefixes: readonly string[]): number | null {
  const m = String(ref ?? "").trim().match(/^(?:([A-Za-z]+)-)?0*(\d+)$/);
  if (!m) return null;
  if (m[1] && !prefixes.includes(m[1].toUpperCase())) return null;
  const n = Number(m[2]);
  return n > 0 ? n : null;
}

/** Shorten long free text for a compact tool result; null/blank becomes null. */
export function clip(text: string | null | undefined, max = 600): string | null {
  const s = (text ?? "").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}… [truncated, ${s.length} chars]` : s;
}
