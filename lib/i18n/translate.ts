/**
 * The translator core: key lookup with per-key English fallback, ICU-lite formatting,
 * rich text and server-message translation. Pure and isomorphic — `getT()` (server,
 * lib/i18n/server.ts) and `useT()` (client, lib/i18n/client.tsx) both wrap it.
 */
import { Fragment, createElement, type ReactNode } from "react";
import { FALLBACK_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/config";
import { formatMessage, type MessageValue, type MessageVars } from "@/lib/i18n/format-message";
import { catalogs, serverCatalogs, type Messages, type Namespace } from "@/messages";

export type { Namespace, Messages };
export type MessageKey<N extends Namespace> = keyof Messages[N] & string;
export type RichValue = MessageValue | ReactNode | ((chunks: ReactNode) => ReactNode);

/** "ticketCount" → "Ticket count": the last-resort text when a key is missing everywhere. */
function humanize(key: string): string {
  const last = key.split(".").pop() ?? key;
  const words = last.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The raw message for a key: the locale's text, else English, else null. */
export function lookupMessage(locale: Locale, ns: Namespace, key: string): string | null {
  const own = (catalogs[locale]?.[ns] as Record<string, string | undefined> | undefined)?.[key];
  if (own) return own;
  if (locale !== FALLBACK_LOCALE) {
    const en = (catalogs[FALLBACK_LOCALE][ns] as Record<string, string | undefined>)[key];
    if (en) return en;
  }
  return null;
}

export type Translator<N extends Namespace> = {
  /** The message for `key`, formatted with `vars`. */
  (key: MessageKey<N>, vars?: MessageVars): string;
  /** A key computed at runtime (e.g. `` `status.${value}` ``); `fallback` when it does not exist. */
  dyn(key: string, vars?: MessageVars, fallback?: string): string;
  /** Whether `key` exists in this namespace. */
  has(key: string): boolean;
  /**
   * Rich text: `<tag>chunks</tag>` in the message call the function value of the same name,
   * `{name}` placeholders accept React nodes.
   */
  rich(key: MessageKey<N>, values?: Record<string, RichValue>): ReactNode;
  readonly locale: Locale;
  readonly namespace: N;
};

const SENTINEL = "\u0000";

function richFormat(msg: string, values: Record<string, RichValue>, locale: Locale): ReactNode {
  // 1) Replace node-valued placeholders by sentinels, format the rest as text.
  const nodes: ReactNode[] = [];
  const textVars: MessageVars = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === "function") continue;
    if (v === null || v === undefined || typeof v === "string" || typeof v === "number" || v instanceof Date) {
      textVars[k] = v;
    } else {
      nodes.push(v as ReactNode);
      textVars[k] = `${SENTINEL}${nodes.length - 1}${SENTINEL}`;
    }
  }
  const text = formatMessage(msg, textVars, INTL_LOCALE[locale]);

  // 2) Split into tags and sentinels.
  let keyCounter = 0;
  const expand = (s: string): ReactNode[] => {
    const out: ReactNode[] = [];
    const re = new RegExp(`<([a-zA-Z][\\w-]*)>([\\s\\S]*?)</\\1>|<([a-zA-Z][\\w-]*)\\s*/>|${SENTINEL}(\\d+)${SENTINEL}`, "g");
    let last = 0;
    for (const m of s.matchAll(re)) {
      if (m.index > last) out.push(s.slice(last, m.index));
      if (m[1]) {
        const fn = values[m[1]];
        const inner = expand(m[2]);
        out.push(
          typeof fn === "function"
            ? createElement(Fragment, { key: `t${keyCounter++}` }, fn(inner.length === 1 ? inner[0] : inner))
            : createElement(Fragment, { key: `t${keyCounter++}` }, ...inner),
        );
      } else if (m[3]) {
        const fn = values[m[3]];
        out.push(typeof fn === "function" ? createElement(Fragment, { key: `t${keyCounter++}` }, fn(null)) : null);
      } else if (m[4] !== undefined) {
        out.push(createElement(Fragment, { key: `t${keyCounter++}` }, nodes[Number(m[4])]));
      }
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };
  const parts = expand(text);
  return parts.length === 1 ? parts[0] : createElement(Fragment, null, ...parts);
}

export function createTranslator<N extends Namespace>(locale: Locale, ns: N): Translator<N> {
  const intl = INTL_LOCALE[locale];
  const resolve = (key: string, vars?: MessageVars, fallback?: string) => {
    const msg = lookupMessage(locale, ns, key);
    if (msg === null) {
      if (process.env.NODE_ENV !== "production" && fallback === undefined) {
        console.warn(`[i18n] missing key "${ns}.${key}"`);
      }
      return fallback ?? humanize(key);
    }
    return formatMessage(msg, vars, intl);
  };
  const t = ((key: string, vars?: MessageVars) => resolve(key, vars)) as unknown as Translator<N>;
  t.dyn = (key, vars, fallback) => resolve(key, vars, fallback ?? humanize(key));
  t.has = (key) => lookupMessage(locale, ns, key) !== null;
  t.rich = (key, values = {}) => {
    const msg = lookupMessage(locale, ns, key) ?? humanize(key);
    return richFormat(msg, values, locale);
  };
  Object.defineProperty(t, "locale", { value: locale });
  Object.defineProperty(t, "namespace", { value: ns });
  return t;
}

/**
 * Translate a message produced on the server in English (an action's `error`, a Zod
 * message, a thrown Error's text) via the source-string catalogs in messages/server/.
 * Unknown text is returned unchanged, so English always works.
 */
export function translateServerMessage(locale: Locale, message: string | null | undefined): string {
  if (!message) return message ?? "";
  const catalog = serverCatalogs[locale];
  if (!catalog) return message;
  const exact = catalog.messages[message];
  if (exact) return exact;
  for (const [re, replacement] of catalog.patterns) {
    if (re.test(message)) return message.replace(re, replacement);
  }
  return message;
}

/** Translate every message of a `fieldErrors` record. */
export function translateFieldErrors<T extends Record<string, string[] | undefined>>(
  locale: Locale,
  fieldErrors: T | undefined,
): T | undefined {
  if (!fieldErrors) return fieldErrors;
  const out: Record<string, string[] | undefined> = {};
  for (const [k, v] of Object.entries(fieldErrors)) out[k] = v?.map((m) => translateServerMessage(locale, m));
  return out as T;
}
