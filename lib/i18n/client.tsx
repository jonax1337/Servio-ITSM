"use client";

/**
 * Client-side i18n: the root layout renders <I18nProvider locale=…> with the locale the
 * server resolved, and client components read it through these hooks. The catalogs are
 * bundled (they are plain TS modules), so nothing is fetched at runtime.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { FALLBACK_LOCALE, type Locale } from "@/lib/i18n/config";
import {
  createTranslator,
  translateFieldErrors,
  translateServerMessage,
  type MessageKey,
  type Namespace,
  type Translator,
} from "@/lib/i18n/translate";
import { createEnumTranslator, type EnumTranslator } from "@/lib/i18n/enums";
import { createFormatter, type Formatter } from "@/lib/i18n/format";
import type { MessageVars } from "@/lib/i18n/format-message";

const LocaleContext = createContext<Locale>(FALLBACK_LOCALE);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** `const t = useT("tickets"); t("newTicket")` — see lib/i18n/translate.ts for the API. */
export function useT<N extends Namespace>(ns: N): Translator<N> {
  const locale = useLocale();
  return useMemo(() => createTranslator(locale, ns), [locale, ns]);
}

/** `const te = useEnumT(); te(TICKET_STATUS_META[s])`. */
export function useEnumT(): EnumTranslator {
  const locale = useLocale();
  return useMemo(() => createEnumTranslator(locale), [locale]);
}

/** `const f = useFormatter(); f.date(d)`, `f.relative(d)`, `f.number(n)`. */
export function useFormatter(): Formatter {
  const locale = useLocale();
  return useMemo(() => createFormatter(locale), [locale]);
}

/**
 * Translate an English message returned by the server (an action's `error`, a Zod field
 * message): `const tm = useServerMessage(); toast.error(tm(res.error))`.
 * `tm.fields(state.fieldErrors)` translates a whole fieldErrors record.
 */
export function useServerMessage() {
  const locale = useLocale();
  return useMemo(
    () =>
      Object.assign((message: string | null | undefined) => translateServerMessage(locale, message), {
        fields: <T extends Record<string, string[] | undefined>>(fe: T | undefined) => translateFieldErrors(locale, fe),
      }),
    [locale],
  );
}

/**
 * A translated string as a component — for shared components that render both inside
 * Server and Client Components and so can use neither `getT` nor `useT`.
 * `<Msg ns="components" k="pagination.next" />`
 */
export function Msg<N extends Namespace>({ ns, k, vars }: { ns: N; k: MessageKey<N>; vars?: MessageVars }) {
  const t = useT(ns);
  return <>{t(k, vars)}</>;
}

/** A translated enum label as a component (see Msg); used by StatusBadge/ToneBadge. */
export function EnumMsg({ map, value, fallback }: { map: string; value: string; fallback: string }) {
  const locale = useLocale();
  const te = useMemo(() => createEnumTranslator(locale), [locale]);
  return <>{te.byName(map, value, fallback)}</>;
}
