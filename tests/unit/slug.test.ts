import { describe, expect, it } from "vitest";
import { slugify, transliterate } from "@/lib/slug";

describe("slugify", () => {
  it("spells out German umlauts and sharp s instead of dropping them", () => {
    expect(slugify("Passwort ändern")).toBe("passwort-aendern");
    expect(slugify("Von außerhalb arbeiten (VPN)")).toBe("von-ausserhalb-arbeiten-vpn");
    expect(slugify("Übersicht über Größen")).toBe("uebersicht-ueber-groessen");
    expect(slugify("Köln")).toBe("koeln");
  });

  it("strips other diacritics", () => {
    expect(slugify("Café résumé naïve")).toBe("cafe-resume-naive");
    expect(slugify("Łódź Smørrebrød")).toBe("lodz-smorrebrod");
    expect(transliterate("Œuvre Æsir")).toBe("oeuvre aesir");
  });

  it("keeps plain ASCII titles exactly as before", () => {
    expect(slugify("How to reset a password")).toBe("how-to-reset-a-password");
    expect(slugify("  --VPN & Wi-Fi!!  ")).toBe("vpn-wi-fi");
  });

  it("falls back when nothing usable is left and caps the length without a trailing dash", () => {
    expect(slugify("???")).toBe("article");
    expect(slugify("???", "x")).toBe("x");
    const long = slugify(`${"a".repeat(79)} b c`);
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("-")).toBe(false);
  });
});
