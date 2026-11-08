import { isValidTimeZone } from "@/lib/oncall-rules";
import type { Meta } from "@/lib/constants";
import type { Translator } from "@/lib/i18n/translate";

const zoneOrUtc = (timezone: string) => (isValidTimeZone(timezone) ? timezone : "UTC");

/**
 * "Mon 5 Jan, 09:00" in the schedule's own time zone, so everyone reads the same handoff times.
 * `intlLocale` is the viewer's BCP 47 tag (INTL_LOCALE); en-GB keeps the day-first English form.
 */
export function formatInZone(date: Date, timezone: string, intlLocale = "en-GB"): string {
  return new Intl.DateTimeFormat(intlLocale === "en-US" ? "en-GB" : intlLocale, {
    timeZone: zoneOrUtc(timezone),
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** "Mon 5 Jan" in the schedule's time zone. */
export function formatDayInZone(date: Date, timezone: string, intlLocale = "en-GB"): string {
  return new Intl.DateTimeFormat(intlLocale === "en-US" ? "en-GB" : intlLocale, {
    timeZone: zoneOrUtc(timezone),
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

/** "YYYY-MM-DDTHH:mm" wall-clock time in the schedule's zone, the value format of a datetime-local input. */
export function toDateTimeInputValue(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zoneOrUtc(timezone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/** How often the rotation hands off: "Every day", "Every week" or "Every 12 h" (translated when `t` is given). */
export function cadenceLabel(rotationType: string, customIntervalHours: number | null, t?: Translator<"oncall">): string {
  if (rotationType === "DAILY") return t ? t("everyDay") : "Every day";
  if (rotationType === "WEEKLY") return t ? t("everyWeek") : "Every week";
  return t ? t("everyHours", { hours: customIntervalHours ?? "?" }) : `Every ${customIntervalHours ?? "?"} h`;
}

export const ACTIVE_META: Meta = { label: "Active", tone: "success" };
export const INACTIVE_META: Meta = { label: "Inactive", tone: "neutral" };

/** ACTIVE_META / INACTIVE_META with the label in the viewer's language (`common` namespace). */
export function activityMeta(active: boolean, tc: Translator<"common">): Meta {
  return active ? { ...ACTIVE_META, label: tc("active") } : { ...INACTIVE_META, label: tc("inactive") };
}
