import { describe, expect, it } from "vitest";
import { parseInboundLogNote, skippedAttachmentsNote } from "@/lib/mail-inbound/log-note";
import { DEFAULT_TEMPLATES_BY_LOCALE, portalLinkHtml, previewTemplate } from "@/lib/email-templates";
import { userPatchSchema } from "@/lib/api-user-input";

describe("inbound log note", () => {
  it("reads a reject reason", () => {
    expect(parseInboundLogNote("sender_unknown")).toEqual({ kind: "reason", reason: "sender_unknown" });
    expect(parseInboundLogNote("denied")).toEqual({ kind: "reason", reason: "denied" });
  });

  it("round-trips skipped attachments", () => {
    expect(parseInboundLogNote(skippedAttachmentsNote(["setup.exe", "run.bat"]))).toEqual({ kind: "skippedAttachments", filenames: "setup.exe, run.bat" });
  });

  it("ignores empty and foreign text (outbound SMTP errors)", () => {
    expect(parseInboundLogNote(null)).toBeNull();
    expect(parseInboundLogNote("Connection timeout")).toBeNull();
  });
});

describe("rejection auto-answer template", () => {
  it("points to the portal in both languages", () => {
    const link = portalLinkHtml("https://desk.example/portal", "Servio");
    const en = previewTemplate(DEFAULT_TEMPLATES_BY_LOCALE.en.inbound_rejected, { vars: { appName: "Servio", senderName: "Jane", subject: "Printer", link } });
    // Nothing the sender wrote comes back: the From address of a turned-away mail can be forged (backscatter).
    expect(en.subject).toBe("Your email could not be accepted");
    expect(en.html).not.toContain("Jane");
    expect(en.html).not.toContain("Printer");
    expect(en.html).toContain('href="https://desk.example/portal"');
    const de = previewTemplate(DEFAULT_TEMPLATES_BY_LOCALE.de.inbound_rejected, {
      vars: { appName: "Servio", senderName: "Erika", subject: "Drucker", link: portalLinkHtml("https://desk.example/portal", "Servio", "de") },
    });
    expect(de.subject).toBe("Ihre E-Mail konnte nicht angenommen werden");
    expect(de.html).not.toContain("Erika");
    expect(de.html).not.toContain("Drucker");
    expect(de.html).toContain("Zum Portal von Servio");
  });

  it("leaves the link out without a public URL", () => {
    expect(portalLinkHtml(null, "Servio")).toBe("");
  });
});

describe("PATCH /users/{id} body", () => {
  it("accepts a list of addresses", () => {
    expect(userPatchSchema.safeParse({ secondary_emails: ["a@x.example"] }).success).toBe(true);
    expect(userPatchSchema.safeParse({ secondary_emails: [] }).success).toBe(true);
  });

  it("is strict about unknown fields and camelCase", () => {
    expect(userPatchSchema.safeParse({ secondary_emails: [], name: "x" }).success).toBe(false);
    expect(userPatchSchema.safeParse({ secondaryEmails: [] }).success).toBe(false);
  });
});
