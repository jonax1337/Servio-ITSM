/**
 * Locale-aware date and number formatting (date-fns + Intl). Use instead of hard-coded
 * English patterns like `format(d, "MMM d, yyyy")`, whose word order is English-only.
 * Pure and isomorphic; get one via `getFormatter()` (server) or `useFormatter()` (client).
 */
import { format, formatDistance, formatDistanceToNow, type Locale as DateFnsLocale } from "date-fns";
import { de as dateFnsDe, enUS as dateFnsEn } from "date-fns/locale";
import { INTL_LOCALE, type Locale } from "@/lib/i18n/config";

const DATE_FNS_LOCALES: Record<Locale, DateFnsLocale> = { en: dateFnsEn, de: dateFnsDe };

export function dateFnsLocale(locale: Locale): DateFnsLocale {
  return DATE_FNS_LOCALES[locale];
}

/**
 * Named styles map onto date-fns' localized tokens, so the word order follows the locale:
 *   date      Nov 8, 2026        8. Nov. 2026
 *   dateLong  November 8, 2026   8. November 2026
 *   dateShort Nov 8              8. Nov.
 *   dateTime  Nov 8, 2026, 2:05 PM   8. Nov. 2026 14:05
 *   time      2:05 PM            14:05
 *   weekday   Sunday, Nov 8      Sonntag, 8. Nov.
 */
export const DATE_STYLES = {
  date: "PP",
  dateLong: "PPP",
  dateShort: { en: "MMM d", de: "d. MMM" },
  dateTime: "PPp",
  time: "p",
  weekday: { en: "EEEE, MMM d", de: "EEEE, d. MMM" },
  monthYear: "LLLL yyyy",
} as const;
export type DateStyle = keyof typeof DATE_STYLES;

function pattern(style: DateStyle, locale: Locale): string {
  const p = DATE_STYLES[style];
  return typeof p === "string" ? p : p[locale];
}

export type Formatter = {
  readonly locale: Locale;
  readonly dateFnsLocale: DateFnsLocale;
  /** A date in a named style (default "date"). Null/invalid input renders "—". */
  date(value: Date | string | number | null | undefined, style?: DateStyle): string;
  /** A date-fns pattern of your own, formatted with the locale (month/day names translated). */
  pattern(value: Date | string | number, pattern: string): string;
  /** "3 minutes ago" / "vor 3 Minuten". */
  relative(value: Date | string | number): string;
  /** "3 minutes" / "3 Minuten" between two dates. */
  distance(from: Date | string | number, to: Date | string | number): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
  percent(value: number, fractionDigits?: number): string;
};

function toDate(v: Date | string | number): Date {
  return v instanceof Date ? v : new Date(v);
}

export function createFormatter(locale: Locale): Formatter {
  const dl = DATE_FNS_LOCALES[locale];
  const intl = INTL_LOCALE[locale];
  return {
    locale,
    dateFnsLocale: dl,
    date(value, style = "date") {
      if (value === null || value === undefined || value === "") return "—";
      const d = toDate(value);
      if (Number.isNaN(d.getTime())) return "—";
      return format(d, pattern(style, locale), { locale: dl });
    },
    pattern(value, p) {
      return format(toDate(value), p, { locale: dl });
    },
    relative(value) {
      return formatDistanceToNow(toDate(value), { addSuffix: true, locale: dl });
    },
    distance(from, to) {
      return formatDistance(toDate(from), toDate(to), { locale: dl });
    },
    number(value, options) {
      return new Intl.NumberFormat(intl, options).format(value);
    },
    percent(value, fractionDigits = 0) {
      return new Intl.NumberFormat(intl, {
        style: "percent",
        maximumFractionDigits: fractionDigits,
      }).format(value);
    },
  };
}
