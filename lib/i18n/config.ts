/**
 * Locale configuration shared by server and client code (no server-only imports).
 * See docs/i18n.md for how locales are resolved and how to add one.
 */

/** Every locale that ships a complete message catalog. English is the source language. */
export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];

/** The language every catalog falls back to, key by key. */
export const FALLBACK_LOCALE: Locale = "en";

/**
 * Stored in `User.locale` when the user follows the instance default
 * (Settings › General › Default language, env `APP_LOCALE`). New users start here.
 */
export const AUTO_LOCALE = "auto";

/** Cookie that remembers the last chosen language for signed-out pages (login, survey). */
export const LOCALE_COOKIE = "servio-locale";

/** The language's own name — shown in pickers, never translated. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
};

/** BCP 47 tag for `Intl.*` formatting (dates, numbers, plural rules). */
export const INTL_LOCALE: Record<Locale, string> = {
  en: "en-US",
  de: "de-DE",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Map a stored or configured value ("de", "de-DE", "DE_at", " en ") onto a supported
 * locale, or null when it is empty, "auto" or not supported.
 */
export function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const base = value.trim().toLowerCase().replace("_", "-").split("-")[0];
  return isLocale(base) ? base : null;
}

/**
 * The effective locale. Signed in (`user` is a string, possibly "auto"): the user's explicit
 * choice, else the instance default. Signed out (`user` undefined/null): the language cookie,
 * else the instance default. English last. Pure so the precedence is unit-testable.
 */
export function pickLocale(input: {
  user?: string | null;
  cookie?: string | null;
  instance?: string | null;
}): Locale {
  const signedIn = typeof input.user === "string";
  return (
    (signedIn ? normalizeLocale(input.user) : normalizeLocale(input.cookie)) ??
    normalizeLocale(input.instance) ??
    FALLBACK_LOCALE
  );
}
