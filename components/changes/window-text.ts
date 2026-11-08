import type { Formatter } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translate";
import type { PlannedWindow } from "@/lib/change-rules";

/**
 * A planned window in the viewer's language — the localized counterpart of
 * formatPlannedWindow (lib/change-rules.ts), whose English text is kept for stored comments.
 */
export function formatWindow({ start, end }: PlannedWindow, f: Formatter, t: Translator<"changes">): string {
  if (start && end) return `${f.date(start, "dateTime")} – ${f.date(end, "dateTime")}`;
  if (start) return t("window.from", { date: f.date(start, "dateTime") });
  if (end) return t("window.until", { date: f.date(end, "dateTime") });
  return t("window.notSet");
}
