import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_NOTIFICATIONS,
  EMAIL_NOTIFICATION_CATEGORIES,
  emailNotificationCategory,
  emailNotificationPrefsFromForm,
  noticeTextEn,
  parseEmailNotificationPrefs,
  type EmailNotice,
} from "@/lib/notification-email-rules";
import { noticeTextDe } from "@/messages/emails/de";
import { DEFAULT_TEMPLATES_BY_LOCALE, previewTemplate } from "@/lib/email-templates";
import en from "@/messages/en/account";

const date = (d: Date) => d.toISOString().slice(0, 10);
const ticket = { ref: "INC-0042", title: "Printer" };

const NOTICES: EmailNotice[] = [
  { kind: "TICKET_UNASSIGNED", groupName: "Service Desk" },
  { kind: "REQUESTER_REPLY", authorName: "Max", snippet: "Still broken" },
  { kind: "SLA_ESCALATION", percent: 80 },
  { kind: "SLA_NUDGE", percent: 75 },
  { kind: "SLA_NUDGE", percent: 120 },
  { kind: "CONTRACT_RENEWAL", name: "Copier lease", endDate: new Date("2026-12-31T00:00:00Z"), autoRenew: true },
  { kind: "LICENSE_OVER_ALLOCATED", name: "Office", used: 12, seats: 10 },
  { kind: "RECURRING_FAILED", name: "Monthly backup check", error: "The group no longer exists." },
];

describe("email notification preferences", () => {
  it("defaults to everything but the unassigned-ticket copy", () => {
    expect(parseEmailNotificationPrefs(null)).toEqual(DEFAULT_EMAIL_NOTIFICATIONS);
    expect(DEFAULT_EMAIL_NOTIFICATIONS).toEqual({ NEW_UNASSIGNED: false, REQUESTER_REPLY: true, SLA: true, CONTRACTS: true, RECURRING: true });
  });

  it("keeps stored choices and falls back per key", () => {
    expect(parseEmailNotificationPrefs('{"SLA":false,"NEW_UNASSIGNED":true,"BOGUS":true,"CONTRACTS":"no"}')).toEqual({
      ...DEFAULT_EMAIL_NOTIFICATIONS,
      SLA: false,
      NEW_UNASSIGNED: true,
    });
  });

  it.each(["not json", "[]", "null", "42"])("treats %s as the defaults", (raw) => {
    expect(parseEmailNotificationPrefs(raw)).toEqual(DEFAULT_EMAIL_NOTIFICATIONS);
  });

  it("reads the form: a missing switch is off", () => {
    const form = new Map([["emailNotify.SLA", "on"], ["emailNotify.RECURRING", "on"]]);
    expect(emailNotificationPrefsFromForm((name) => form.get(name))).toEqual({
      NEW_UNASSIGNED: false,
      REQUESTER_REPLY: false,
      SLA: true,
      CONTRACTS: false,
      RECURRING: true,
    });
  });

  it("has a label and a hint for every category", () => {
    for (const category of EMAIL_NOTIFICATION_CATEGORIES) {
      expect(en[`notify.${category}.label`]).toBeTruthy();
      expect(en[`notify.${category}.hint`]).toBeTruthy();
    }
  });
});

describe("notification email wording", () => {
  it("maps each notice to its category", () => {
    expect(NOTICES.map(emailNotificationCategory)).toEqual([
      "NEW_UNASSIGNED", "REQUESTER_REPLY", "SLA", "SLA", "SLA", "CONTRACTS", "CONTRACTS", "RECURRING",
    ]);
  });

  it.each(NOTICES.map((n) => [n.kind, n] as const))("words %s in English and German", (_kind, notice) => {
    for (const fn of [noticeTextEn, noticeTextDe]) {
      const text = fn(notice, ticket, date);
      expect(text.subject.trim()).not.toBe("");
      expect(text.message.trim()).not.toBe("");
    }
  });

  it("names the ticket and the quoted text", () => {
    const reply = noticeTextDe({ kind: "REQUESTER_REPLY", authorName: "Max", snippet: "Geht immer noch nicht" }, ticket, date);
    expect(reply.subject).toBe("[INC-0042] Max hat geantwortet: Printer");
    expect(reply.details).toBe("Geht immer noch nicht");
    const nudge = noticeTextEn({ kind: "SLA_NUDGE", percent: 120 }, ticket, date);
    expect(nudge.subject).toBe("[INC-0042] Past its SLA: Printer");
  });

  it("formats contract dates with the given formatter", () => {
    const text = noticeTextEn(NOTICES[5], {}, date);
    expect(text.subject).toBe("Contract “Copier lease” ends on 2026-12-31");
    expect(text.message).toContain("renews automatically");
  });

  it("is carried by the notification template in both languages", () => {
    for (const locale of ["en", "de"] as const) {
      const out = previewTemplate(DEFAULT_TEMPLATES_BY_LOCALE[locale].notification, {
        vars: { appName: "Servio", recipientName: "Alex", subject: "[INC-0042] Hello", message: "Lead &amp; text", details: "", link: "" },
      });
      expect(out.subject).toBe("[INC-0042] Hello");
      expect(out.html).toContain("Lead &amp; text");
    }
  });
});
