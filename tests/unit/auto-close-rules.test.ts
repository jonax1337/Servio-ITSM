import { describe, expect, it } from "vitest";
import {
  AUTO_CLOSE_DAYS_ERROR,
  MAX_AUTO_CLOSE_DAYS,
  autoCloseAuditSummary,
  autoCloseCutoff,
  normalizeAutoCloseDays,
  parseAutoCloseDaysInput,
} from "@/lib/auto-close-rules";
import { DEFAULT_TEMPLATES_BY_LOCALE, autoCloseNoticeHtml, previewTemplate } from "@/lib/email-templates";
import { translateServerMessage } from "@/lib/i18n/translate";

const now = new Date("2026-11-08T12:00:00Z");

describe("normalizeAutoCloseDays", () => {
  it("keeps whole positive days", () => {
    expect(normalizeAutoCloseDays(7)).toBe(7);
    expect(normalizeAutoCloseDays(7.9)).toBe(7);
  });

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])("treats %s as off", (value) => {
    expect(normalizeAutoCloseDays(value)).toBe(0);
  });

  it("caps at the maximum", () => {
    expect(normalizeAutoCloseDays(99_999)).toBe(MAX_AUTO_CLOSE_DAYS);
  });
});

describe("parseAutoCloseDaysInput", () => {
  it("accepts 0, empty and whole numbers up to the maximum", () => {
    expect(parseAutoCloseDaysInput("")).toEqual({ days: 0 });
    expect(parseAutoCloseDaysInput(" 0 ")).toEqual({ days: 0 });
    expect(parseAutoCloseDaysInput("14")).toEqual({ days: 14 });
    expect(parseAutoCloseDaysInput(String(MAX_AUTO_CLOSE_DAYS))).toEqual({ days: MAX_AUTO_CLOSE_DAYS });
  });

  it.each(["-1", "1.5", "abc", "7d", String(MAX_AUTO_CLOSE_DAYS + 1)])("refuses %s", (raw) => {
    expect(parseAutoCloseDaysInput(raw)).toEqual({ error: AUTO_CLOSE_DAYS_ERROR });
  });

  it("has a German translation of the refusal", () => {
    expect(translateServerMessage("de", AUTO_CLOSE_DAYS_ERROR)).not.toBe(AUTO_CLOSE_DAYS_ERROR);
  });
});

describe("autoCloseCutoff", () => {
  it("is off for 0 days", () => {
    expect(autoCloseCutoff(now, 0)).toBeNull();
  });

  it("lies the configured number of days back", () => {
    expect(autoCloseCutoff(now, 7)?.toISOString()).toBe("2026-11-01T12:00:00.000Z");
  });
});

describe("autoCloseAuditSummary", () => {
  it("names the delay", () => {
    expect(autoCloseAuditSummary(1)).toBe("Closed automatically after 1 day in Resolved");
    expect(autoCloseAuditSummary(10)).toBe("Closed automatically after 10 days in Resolved");
  });
});

describe("auto-close notice in the resolved email", () => {
  it("is empty while automatic closing is off", () => {
    expect(autoCloseNoticeHtml(0)).toBe("");
  });

  it("names the delay in the recipient's language", () => {
    expect(autoCloseNoticeHtml(1)).toContain("in 1 day.");
    expect(autoCloseNoticeHtml(5)).toContain("in 5 days.");
    expect(autoCloseNoticeHtml(1, "de")).toContain("in 1 Tag automatisch");
    expect(autoCloseNoticeHtml(5, "de")).toContain("in 5 Tagen automatisch");
  });

  it("is part of the built-in resolved template in every language", () => {
    for (const locale of ["en", "de"] as const) {
      const tpl = DEFAULT_TEMPLATES_BY_LOCALE[locale].ticket_resolved;
      const on = previewTemplate(tpl, { vars: { ref: "INC-1", autoCloseNotice: autoCloseNoticeHtml(3, locale) } });
      expect(on.html).toContain(locale === "de" ? "in 3 Tagen automatisch geschlossen" : "closed automatically in 3 days");
      const off = previewTemplate(tpl, { vars: { ref: "INC-1", autoCloseNotice: autoCloseNoticeHtml(0, locale) } });
      expect(off.html).not.toContain(locale === "de" ? "automatisch geschlossen" : "closed automatically");
    }
  });
});
