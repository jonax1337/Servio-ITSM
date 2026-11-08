/**
 * Instance-level locale lookups without request context — safe in Server Components,
 * Server Actions, Route Handlers and background jobs (mail, scheduler) alike.
 */
import { getSetting } from "@/lib/settings";
import { FALLBACK_LOCALE, normalizeLocale, type Locale } from "@/lib/i18n/config";

/**
 * The instance default language: Settings › General › Default language (AppSetting
 * `APP_LOCALE`), else env `APP_LOCALE`, else English.
 */
export async function getInstanceLocale(): Promise<Locale> {
  try {
    return normalizeLocale(await getSetting("APP_LOCALE")) ?? FALLBACK_LOCALE;
  } catch {
    return FALLBACK_LOCALE;
  }
}

/** A recipient's language: their explicit `User.locale`, else ("auto", unknown, no user) the instance default. */
export async function localeForUser(user: { locale?: string | null } | null | undefined): Promise<Locale> {
  return normalizeLocale(user?.locale) ?? (await getInstanceLocale());
}
