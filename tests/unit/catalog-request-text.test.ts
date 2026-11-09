import { describe, expect, it } from "vitest";
import { catalogRequestDescription } from "@/lib/catalog-request-text";
import { createTranslator } from "@/lib/i18n/translate";

describe("catalogRequestDescription", () => {
  it("uses the instance language, not a hard-coded English lead", () => {
    expect(catalogRequestDescription("de", "Neuer Laptop", "")).toBe("Katalog-Anfrage: Neuer Laptop.");
    expect(catalogRequestDescription("en", "New laptop", "")).toBe("Catalog request: New laptop.");
  });

  it("appends the answers after a blank line", () => {
    expect(catalogRequestDescription("de", "Neuer Laptop", "Modell: X")).toBe("Katalog-Anfrage: Neuer Laptop.\n\nModell: X");
  });
});

describe("portal request page title", () => {
  it("does not repeat the verb of a catalog item named like an action", () => {
    const t = createTranslator("de", "portal");
    expect(t("requestTitle", { name: "Anfrage stellen" })).toBe("Anfordern: Anfrage stellen");
    expect(t("requestTitle", { name: "Anfrage stellen" })).not.toMatch(/stellen anfordern/);
    expect(createTranslator("en", "portal")("requestTitle", { name: "Order a laptop" })).toBe("Request: Order a laptop");
  });
});
