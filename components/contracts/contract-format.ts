/**
 * Locale-aware display helpers for contracts and licenses. Pure and isomorphic.
 * The English originals (`formatDay`, `formatCost`, `expiryNotice` in lib/contract-rules.ts)
 * stay for Sable and the scheduler; the UI renders through these.
 */
import { INTL_LOCALE, type Locale } from "@/lib/i18n/config";
import type { Translator } from "@/lib/i18n/translate";
import { contractExpiry, daysUntil, type ContractTimeline, type ExpiryNotice } from "@/lib/contract-rules";

/** A calendar day ("Nov 5, 2026" / "5. Nov. 2026"), read in UTC so it matches what the date input stored. */
export const formatDayIn = (locale: Locale, date: Date) =>
  date.toLocaleDateString(INTL_LOCALE[locale], { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });

/** Currency-neutral amount with two decimals in the locale's number format. */
export const formatCostIn = (locale: Locale, amount: number) =>
  amount.toLocaleString(INTL_LOCALE[locale], { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Ends today" / "Ends tomorrow" / "Ends in 5 days". */
export function endsLabel(t: Translator<"contracts">, days: number): string {
  if (days === 0) return t("expiry.endsToday");
  if (days === 1) return t("expiry.endsTomorrow");
  return t("expiry.endsInDays", { days });
}

/** The localized sentence shown on a contract that needs attention (see lib/contract-rules.ts expiryNotice). */
export function expiryNoticeIn(
  t: Translator<"contracts">,
  contract: ContractTimeline & { autoRenew: boolean },
  now: Date,
): ExpiryNotice | null {
  const expiry = contractExpiry(contract, now);
  const endDate = contract.endDate;
  if (!endDate || (expiry !== "EXPIRING" && expiry !== "EXPIRED")) return null;
  const day = formatDayIn(t.locale, endDate);
  if (expiry === "EXPIRED") {
    const ended = daysUntil(endDate, now) < 0 ? t("expiry.endedOn", { date: day }) : t("expiry.markedExpired");
    return { tone: "danger", text: `${ended} ${t("expiry.renewHint")}` };
  }
  const next = contract.autoRenew ? t("expiry.autoRenews") : t("expiry.lapses");
  return {
    tone: "warning",
    text: `${t("expiry.insideNotice", { date: day, days: contract.renewalNoticeDays })} ${next}`,
  };
}
