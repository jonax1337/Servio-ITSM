import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getSetting } from "@/lib/settings";
import { LOCALE_COOKIE, normalizeLocale, pickLocale, type Locale, FALLBACK_LOCALE } from "@/lib/i18n/config";
import { createTranslator, translateServerMessage, type Namespace, type Translator } from "@/lib/i18n/translate";
import { createEnumTranslator, type EnumTranslator } from "@/lib/i18n/enums";
import { createFormatter, type Formatter } from "@/lib/i18n/format";

/**
 * The instance default language: Settings › General › Default language (AppSetting
 * `APP_LOCALE`), else env `APP_LOCALE`, else English.
 */
export async function getInstanceLocale(): Promise<Locale> {
  return normalizeLocale(await getSetting("APP_LOCALE")) ?? FALLBACK_LOCALE;
}

/**
 * The locale of the current request (cached per request): the signed-in user's choice
 * (`User.locale`, "auto" = instance default), else — signed out — the language cookie,
 * else the instance default, else English. Works in Server Components, Server Actions and
 * Route Handlers; outside a request (scripts, background jobs) it is the instance default.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  let user: string | null = null;
  let cookie: string | null = null;
  try {
    const row = await getCurrentUser();
    user = row ? (row.locale ?? "auto") : null;
  } catch (err) {
    // Never swallow Next.js control flow (dynamic-rendering bailout, redirect).
    unstable_rethrow(err);
    user = null;
  }
  if (user === null) {
    try {
      cookie = (await cookies()).get(LOCALE_COOKIE)?.value ?? null;
    } catch (err) {
      unstable_rethrow(err);
      cookie = null;
    }
  }
  const instance = await getSetting("APP_LOCALE").catch(() => null);
  return pickLocale({ user: user ?? undefined, cookie, instance });
});

/** A translator for one namespace in the request's locale: `const t = await getT("tickets")`. */
export async function getT<N extends Namespace>(ns: N, locale?: Locale): Promise<Translator<N>> {
  return createTranslator(locale ?? (await getLocale()), ns);
}

/** Enum label translator: `const te = await getEnumT(); te(TICKET_STATUS_META[s])`. */
export async function getEnumT(locale?: Locale): Promise<EnumTranslator> {
  return createEnumTranslator(locale ?? (await getLocale()));
}

/** Locale-aware date/number formatter: `const f = await getFormatter(); f.date(d)`. */
export async function getFormatter(locale?: Locale): Promise<Formatter> {
  return createFormatter(locale ?? (await getLocale()));
}

/** Translate an English server message (action error, Zod message) for the request's locale. */
export async function getServerMessageT(locale?: Locale): Promise<(message: string | null | undefined) => string> {
  const l = locale ?? (await getLocale());
  return (message) => translateServerMessage(l, message);
}

/** Translator for a specific user's locale (emails, notifications): "auto"/unknown → instance default. */
export async function getTForUser<N extends Namespace>(
  user: { locale?: string | null } | null | undefined,
  ns: N,
): Promise<Translator<N>> {
  const locale = normalizeLocale(user?.locale) ?? (await getInstanceLocale());
  return createTranslator(locale, ns);
}
