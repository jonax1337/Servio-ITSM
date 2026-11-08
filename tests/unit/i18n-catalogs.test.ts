import { describe, expect, it } from "vitest";
import * as constants from "@/lib/constants";
import { LOCALES, FALLBACK_LOCALE } from "@/lib/i18n/config";
import { ENUM_MAPS, enumMapName } from "@/lib/i18n/enums";
import { messageArguments, messageTags } from "@/lib/i18n/format-message";
import { catalogs, enumCatalogs, serverCatalogs, type Namespace } from "@/messages";

/**
 * Catalog completeness: every key of the English source exists in every locale with a
 * non-empty value and the same placeholders/tags, and every enum label has a translation.
 * Adding UI text? Add the key to messages/en/<ns>.ts and messages/de/<ns>.ts.
 */
const en = catalogs[FALLBACK_LOCALE] as Record<Namespace, Record<string, string>>;
const namespaces = Object.keys(en) as Namespace[];
const others = LOCALES.filter((l) => l !== FALLBACK_LOCALE);

describe("i18n catalogs", () => {
  it("English has no empty values", () => {
    for (const ns of namespaces) {
      for (const [key, value] of Object.entries(en[ns])) {
        expect(typeof value === "string" && value.trim() !== "", `en.${ns}.${key} is empty`).toBe(true);
      }
    }
  });

  for (const locale of others) {
    const cat = catalogs[locale] as Record<string, Record<string, string> | undefined>;

    it(`${locale} has the same namespaces as en`, () => {
      expect(Object.keys(cat).sort()).toEqual([...namespaces].sort());
    });

    it(`${locale} has every key, non-empty, and no extra keys`, () => {
      const missing: string[] = [];
      const empty: string[] = [];
      const extra: string[] = [];
      for (const ns of namespaces) {
        const own = cat[ns] ?? {};
        for (const key of Object.keys(en[ns])) {
          if (!(key in own)) missing.push(`${ns}.${key}`);
          else if (typeof own[key] !== "string" || own[key].trim() === "") empty.push(`${ns}.${key}`);
        }
        for (const key of Object.keys(own)) if (!(key in en[ns])) extra.push(`${ns}.${key}`);
      }
      expect(missing, `missing in ${locale}`).toEqual([]);
      expect(empty, `empty in ${locale}`).toEqual([]);
      expect(extra, `not in en (stale?) in ${locale}`).toEqual([]);
    });

    it(`${locale} uses the same placeholders and tags as en`, () => {
      const mismatched: string[] = [];
      for (const ns of namespaces) {
        for (const [key, source] of Object.entries(en[ns])) {
          const target = cat[ns]?.[key];
          if (typeof target !== "string") continue;
          if (
            messageArguments(source).join() !== messageArguments(target).join() ||
            messageTags(source).join() !== messageTags(target).join()
          ) {
            mismatched.push(`${ns}.${key}`);
          }
        }
      }
      expect(mismatched).toEqual([]);
    });

    it(`${locale} translates every value of every registered enum map`, () => {
      const enums = enumCatalogs[locale] as Record<string, Record<string, unknown> | undefined> | null;
      expect(enums).not.toBeNull();
      const missing: string[] = [];
      for (const [name, map] of Object.entries(ENUM_MAPS)) {
        for (const [value, meta] of Object.entries(map as Record<string, { label: string; description?: string }>)) {
          const entry = enums?.[name]?.[value];
          const label = typeof entry === "string" ? entry : (entry as { label?: string } | undefined)?.label;
          if (!label || !label.trim()) missing.push(`${name}.${value}`);
          if (meta.description && typeof entry === "object" && !(entry as { description?: string }).description) {
            missing.push(`${name}.${value}.description`);
          }
          if (meta.description && typeof entry === "string") missing.push(`${name}.${value}.description`);
        }
      }
      expect(missing).toEqual([]);
    });

    it(`${locale} server messages are non-empty`, () => {
      const server = serverCatalogs[locale];
      expect(server).not.toBeNull();
      const empty = Object.entries(server!.messages)
        .filter(([, v]) => typeof v !== "string" || v.trim() === "")
        .map(([k]) => k);
      expect(empty).toEqual([]);
    });
  }

  it("every *_META label map in lib/constants.ts is registered for translation", () => {
    const unregistered: string[] = [];
    for (const [name, value] of Object.entries(constants)) {
      if (!name.endsWith("_META") || !value || typeof value !== "object") continue;
      // A single Meta (VIP_META) is not a map.
      if (typeof (value as { label?: unknown }).label === "string") continue;
      const entries = Object.values(value as Record<string, unknown>);
      const isLabelMap = entries.length > 0 && entries.every((e) => !!e && typeof (e as { label?: unknown }).label === "string");
      if (isLabelMap && !enumMapName(value)) unregistered.push(name);
    }
    expect(unregistered, "add these maps to ENUM_MAPS in lib/i18n/enums.ts").toEqual([]);
  });
});
