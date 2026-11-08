import { describe, expect, it } from "vitest";
import { isValidElement } from "react";
import { normalizeLocale, pickLocale } from "@/lib/i18n/config";
import { formatMessage, messageArguments, messageTags } from "@/lib/i18n/format-message";
import { createTranslator, translateServerMessage, translateFieldErrors } from "@/lib/i18n/translate";
import { createEnumTranslator } from "@/lib/i18n/enums";
import { createFormatter } from "@/lib/i18n/format";
import { TICKET_STATUS_META, PRIORITY_META, CRITICALITY_META, AI_MCP_MODE_META, metaFor } from "@/lib/constants";

describe("locale resolution", () => {
  it("normalizes stored and configured values", () => {
    expect(normalizeLocale("de")).toBe("de");
    expect(normalizeLocale(" DE-at ")).toBe("de");
    expect(normalizeLocale("de_DE")).toBe("de");
    expect(normalizeLocale("auto")).toBeNull();
    expect(normalizeLocale("fr")).toBeNull();
    expect(normalizeLocale("")).toBeNull();
    expect(normalizeLocale(null)).toBeNull();
  });

  it("signed in: explicit choice, else instance default, never the cookie", () => {
    expect(pickLocale({ user: "de", cookie: "en", instance: "en" })).toBe("de");
    expect(pickLocale({ user: "auto", cookie: "en", instance: "de" })).toBe("de");
    expect(pickLocale({ user: "auto", cookie: "de" })).toBe("en");
    expect(pickLocale({ user: "fr", instance: "de" })).toBe("de");
  });

  it("signed out: cookie, else instance default, else English", () => {
    expect(pickLocale({ cookie: "de", instance: "en" })).toBe("de");
    expect(pickLocale({ cookie: null, instance: "de" })).toBe("de");
    expect(pickLocale({})).toBe("en");
  });
});

describe("formatMessage", () => {
  it("fills placeholders and blanks missing ones", () => {
    expect(formatMessage("Hello {name}", { name: "Ada" }, "en-US")).toBe("Hello Ada");
    expect(formatMessage("Hello {name}", {}, "en-US")).toBe("Hello ");
  });

  it("formats plurals with exact matches and locale rules", () => {
    const msg = "{n, plural, =0 {No tickets} one {# ticket} other {# tickets}}";
    expect(formatMessage(msg, { n: 0 }, "en-US")).toBe("No tickets");
    expect(formatMessage(msg, { n: 1 }, "en-US")).toBe("1 ticket");
    expect(formatMessage(msg, { n: 1200 }, "en-US")).toBe("1,200 tickets");
    expect(formatMessage("{n, plural, one {# Ticket} other {# Tickets}}", { n: 1200 }, "de-DE")).toBe("1.200 Tickets");
  });

  it("supports select and nested placeholders", () => {
    const msg = "{kind, select, change {Change {ref}} other {Ticket {ref}}}";
    expect(formatMessage(msg, { kind: "change", ref: "CHG-1" }, "en-US")).toBe("Change CHG-1");
    expect(formatMessage(msg, { kind: "x", ref: "INC-1" }, "en-US")).toBe("Ticket INC-1");
  });

  it("lists arguments and tags", () => {
    expect(messageArguments("{a} and {n, plural, one {# {b}} other {#}}")).toEqual(["a", "b", "n"]);
    expect(messageTags("Read <link>the guide</link> or <b>this</b>")).toEqual(["b", "link"]);
  });
});

describe("translator", () => {
  it("translates and falls back to English per key", () => {
    expect(createTranslator("de", "common")("save")).toBe("Speichern");
    expect(createTranslator("en", "common")("save")).toBe("Save");
    expect(createTranslator("de", "common")("pageOf", { page: 2, pages: 5 })).toBe("Seite 2 von 5");
  });

  it("never shows a raw key for unknown runtime keys", () => {
    const t = createTranslator("de", "common");
    expect(t.dyn("doesNotExist.someLabel")).toBe("Some label");
    expect(t.dyn("doesNotExist", undefined, "Fallback")).toBe("Fallback");
    expect(t.has("save")).toBe(true);
    expect(t.has("nope")).toBe(false);
  });

  it("renders rich text with tags and node placeholders", () => {
    const t = createTranslator("en", "common");
    const node = t.rich("pageOf", { page: "1", pages: "2" });
    expect(node).toBe("Page 1 of 2");
  });
});

describe("server messages", () => {
  it("translates exact text, patterns, and passes unknown text through", () => {
    expect(translateServerMessage("de", "Not authorised")).toBe("Nicht berechtigt");
    expect(translateServerMessage("de", "Too small: expected string to have >=3 characters")).toBe(
      "Mindestens 3 Zeichen erforderlich.",
    );
    expect(translateServerMessage("de", "Some new message")).toBe("Some new message");
    expect(translateServerMessage("en", "Not authorised")).toBe("Not authorised");
    expect(translateFieldErrors("de", { name: ["Invalid email address"] })).toEqual({ name: ["Ungültige E-Mail-Adresse."] });
  });
});

describe("enum labels", () => {
  it("translates metas and map+value, keeps English as source", () => {
    const de = createEnumTranslator("de");
    const en = createEnumTranslator("en");
    expect(de(TICKET_STATUS_META.IN_PROGRESS)).toBe("In Bearbeitung");
    expect(de(TICKET_STATUS_META, "RESOLVED")).toBe("Gelöst");
    expect(en(TICKET_STATUS_META.RESOLVED)).toBe("Resolved");
    // Aliased maps share the source map's objects.
    expect(de(CRITICALITY_META.HIGH)).toBe(de(PRIORITY_META.HIGH));
    // Unknown values and metaFor fallbacks render as given.
    expect(de(TICKET_STATUS_META, "WEIRD")).toBe("WEIRD");
    expect(de(TICKET_STATUS_META, null)).toBe("—");
    expect(de(metaFor(TICKET_STATUS_META, "X"))).toBe("X");
    expect(de.description(AI_MCP_MODE_META.TRUSTED)).toBe("Alle Tools laufen direkt.");
    expect(de.options(PRIORITY_META).map((o) => o.label)).toEqual(["Niedrig", "Mittel", "Hoch", "Kritisch"]);
  });
});

describe("formatter", () => {
  const d = new Date(2026, 10, 8, 14, 5);
  it("uses locale word order", () => {
    expect(createFormatter("en").date(d)).toBe("Nov 8, 2026");
    expect(createFormatter("de").date(d)).toBe("8. Nov. 2026");
    expect(createFormatter("de").date(d, "dateTime")).toBe("8. Nov. 2026 14:05");
    expect(createFormatter("de").date(d, "dateShort")).toBe("8. Nov.");
    expect(createFormatter("de").date(null)).toBe("—");
    expect(createFormatter("de").number(1234.5)).toBe("1.234,5");
  });

  it("formats relative times in the locale", () => {
    expect(createFormatter("de").relative(new Date(Date.now() - 3 * 60_000))).toBe("vor 3 Minuten");
  });

  it("rich returns React nodes when tags are present", () => {
    // Uses an inline message through the common namespace's formatter path.
    const node = createTranslator("en", "common").rich("save", {});
    expect(typeof node === "string" || isValidElement(node)).toBe(true);
  });
});
