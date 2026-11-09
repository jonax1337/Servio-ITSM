import { createTranslator } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/config";

/**
 * First lines of a catalog request's ticket description, in the instance language
 * (the text is stored with the ticket, so it cannot follow each reader's locale).
 */
export function catalogRequestDescription(locale: Locale, itemName: string, detail: string): string {
  const head = `${createTranslator(locale, "portal")("catalogRequest")}: ${itemName}.`;
  return detail ? `${head}\n\n${detail}` : head;
}
