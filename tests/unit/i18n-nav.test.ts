import { describe, expect, it } from "vitest";
import { consoleNav, navGroupKey, navItemKey } from "@/lib/nav";
import { catalogs } from "@/messages";

describe("console navigation translations", () => {
  it("every nav group and item has an English and a German label", () => {
    const missing: string[] = [];
    for (const group of consoleNav) {
      const keys = [navGroupKey(group), ...group.items.map(navItemKey)];
      for (const key of keys) {
        for (const locale of ["en", "de"] as const) {
          if (!(catalogs[locale].nav as Record<string, string | undefined>)[key]) missing.push(`${locale}: ${key}`);
        }
      }
    }
    expect(missing, "add these keys to messages/{en,de}/nav.ts").toEqual([]);
  });

  it("English nav labels match the titles in lib/nav.ts", () => {
    const en = catalogs.en.nav as Record<string, string>;
    for (const group of consoleNav) {
      expect(en[navGroupKey(group)]).toBe(group.label);
      for (const item of group.items) expect(en[navItemKey(item)]).toBe(item.title);
    }
  });
});
