import type { Locale } from "@/lib/i18n/config";
import { en, type Messages } from "./en";
import { de } from "./de";
import { enumsDe, type EnumTranslations } from "./de/enums";
import { messages as serverDe, patterns as serverPatternsDe } from "./server/de";
import type { ServerMessagePattern, ServerMessages, Translations } from "./types";

export type { Messages };
export type Namespace = keyof Messages;
export type Catalog = { [N in Namespace]: Partial<Translations<Messages[N]>> };

/** Key-based UI catalogs. English is complete by definition; others fall back to it per key. */
export const catalogs: Record<Locale, Catalog> = { en, de };

/** Enum label translations (keyed by `*_META` map name, then value). English comes from lib/constants. */
export const enumCatalogs: Record<Locale, EnumTranslations | null> = { en: null, de: enumsDe };

/** Server-message catalogs (English source text → translation). English is the identity. */
export const serverCatalogs: Record<Locale, { messages: ServerMessages; patterns: readonly ServerMessagePattern[] } | null> = {
  en: null,
  de: { messages: serverDe, patterns: serverPatternsDe },
};
