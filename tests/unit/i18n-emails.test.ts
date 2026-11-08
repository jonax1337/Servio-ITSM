import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, DEFAULT_TEMPLATES_BY_LOCALE, TEMPLATE_KEYS, previewTemplate, surveyCtaHtml } from "@/lib/email-templates";
import { LOCALES } from "@/lib/i18n/config";

const placeholders = (s: string) => [...new Set([...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort();

describe("localized email template defaults", () => {
  for (const locale of LOCALES) {
    it(`${locale} defines every template with the English placeholders`, () => {
      const set = DEFAULT_TEMPLATES_BY_LOCALE[locale];
      for (const key of TEMPLATE_KEYS) {
        expect(set[key].subject.trim(), `${locale}.${key}.subject`).not.toBe("");
        expect(set[key].bodyHtml.trim(), `${locale}.${key}.bodyHtml`).not.toBe("");
        expect(placeholders(set[key].subject)).toEqual(placeholders(DEFAULT_TEMPLATES[key].subject));
        expect(placeholders(set[key].bodyHtml)).toEqual(placeholders(DEFAULT_TEMPLATES[key].bodyHtml));
      }
    });
  }

  it("renders the German resolved mail and survey link", () => {
    const tpl = DEFAULT_TEMPLATES_BY_LOCALE.de.ticket_resolved;
    const out = previewTemplate(tpl, { vars: { ref: "INC-0001", title: "Drucker", requesterName: "Erika", survey: surveyCtaHtml("https://x.test/s", "de") } });
    expect(out.subject).toBe("[INC-0001] Gelöst: Drucker");
    expect(out.html).toContain("Hallo Erika");
    expect(out.html).toContain("Support bewerten");
    expect(surveyCtaHtml("https://x.test/s")).toContain("Rate our support");
  });
});
