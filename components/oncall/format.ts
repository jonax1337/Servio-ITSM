import { isValidTimeZone } from "@/lib/oncall-rules";
import type { Meta } from "@/lib/constants";

const zoneOrUtc = (timezone: string) => (isValidTimeZone(timezone) ? timezone : "UTC");

/** "Mon 5 Jan, 09:00" in the schedule's own time zone, so everyone reads the same handoff times. */
export function formatInZone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
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
export function formatDayInZone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
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

/** How often the rotation hands off: "Every day", "Every week" or "Every 12 h". */
export function cadenceLabel(rotationType: string, customIntervalHours: number | null): string {
  if (rotationType === "DAILY") return "Every day";
  if (rotationType === "WEEKLY") return "Every week";
  return `Every ${customIntervalHours ?? "?"} h`;
}

export const ACTIVE_META: Meta = { label: "Active", tone: "success" };
export const INACTIVE_META: Meta = { label: "Inactive", tone: "neutral" };
