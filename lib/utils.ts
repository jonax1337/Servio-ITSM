import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * True when a key event comes from somewhere the user is typing (form fields or a
 * contenteditable rich-text editor) — global single-key shortcuts must ignore it.
 */
export function isTextEntryTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName ?? "");
}

/** The distinct, non-empty ids a form posted under one name (`formData.getAll`), in the order chosen. */
export function distinctIds(values: FormDataEntryValue[]): string[] {
  return [...new Set(values.map((v) => String(v).trim()).filter(Boolean))];
}

/** Format a minute count as a compact "2h 15m" / "45m" / "3h" string. */
export function formatMinutes(mins: number) {
  const m = Math.max(0, Math.floor(mins));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h && rest) return `${h}h ${rest}m`;
  if (h) return `${h}h`;
  return `${rest}m`;
}

const LEADING_FULL_NAME = /^[A-Z][a-z]+ [A-Z][a-z]+ [a-z]/;

/**
 * Lower-case a summary's leading verb for "<who> <summary>" flow ("Created via…" ->
 * "created via…"). Keeps refs and acronyms ("PRB-0023", "SLA") and a leading full name
 * ("Liam Chen reported…") intact.
 */
export function lowerLead(text: string) {
  if (LEADING_FULL_NAME.test(text)) return text;
  return text.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase());
}
