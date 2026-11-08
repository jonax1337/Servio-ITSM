import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEMPLATES_BY_LOCALE,
  TEMPLATE_KEYS,
  TEMPLATE_META,
  approvalStageText,
  previewTemplate,
  quotedTextHtml,
} from "@/lib/email-templates";

const placeholders = (s: string) => [...new Set([...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];

describe("approval and closed email templates", () => {
  it("are editable templates", () => {
    for (const key of ["approval_request", "request_approved", "request_rejected", "ticket_closed"] as const) {
      expect(TEMPLATE_KEYS).toContain(key);
    }
  });

  it("list every placeholder their default uses", () => {
    for (const key of TEMPLATE_KEYS) {
      const tpl = DEFAULT_TEMPLATES_BY_LOCALE.en[key];
      for (const v of placeholders(tpl.subject + tpl.bodyHtml)) {
        expect(TEMPLATE_META[key].vars, `${key} uses {{${v}}}`).toContain(v);
      }
    }
  });

  it("render the approval request in the approver's language", () => {
    const vars = {
      appName: "Servio",
      ref: "REQ-0007",
      itemName: "New laptop",
      requesterName: "Max",
      approverName: "Alex",
      details: quotedTextHtml("• Model: 14-inch"),
    };
    const en = previewTemplate(DEFAULT_TEMPLATES_BY_LOCALE.en.approval_request, { vars: { ...vars, stage: approvalStageText(0, 2) } });
    expect(en.subject).toBe("[REQ-0007] Approval needed: New laptop");
    expect(en.html).toContain("needs your approval (stage 1 of 2)");
    expect(en.html).toContain("Model: 14-inch");

    const de = previewTemplate(DEFAULT_TEMPLATES_BY_LOCALE.de.approval_request, { vars: { ...vars, stage: approvalStageText(1, 2, "de") } });
    expect(de.subject).toBe("[REQ-0007] Genehmigung erforderlich: New laptop");
    expect(de.html).toContain("Genehmigung (Stufe 2 von 2)");
  });

  it("leaves the stage out of a single-stage approval", () => {
    expect(approvalStageText(0, 1)).toBe("");
    expect(approvalStageText(0, 1, "de")).toBe("");
  });

  it("render the decision emails with and without a comment", () => {
    const base = { ref: "REQ-0007", itemName: "New laptop", requesterName: "Max" };
    const approved = previewTemplate(DEFAULT_TEMPLATES_BY_LOCALE.en.request_approved, { vars: { ...base, comment: quotedTextHtml("Within budget") } });
    expect(approved.subject).toBe("[REQ-0007] Your request was approved");
    expect(approved.html).toContain("Within budget");
    const rejected = previewTemplate(DEFAULT_TEMPLATES_BY_LOCALE.de.request_rejected, { vars: { ...base, comment: quotedTextHtml(null) } });
    expect(rejected.subject).toBe("[REQ-0007] Ihre Anfrage wurde abgelehnt");
    expect(rejected.html).toContain("leider abgelehnt");
  });

  it("escapes HTML in a comment", () => {
    expect(quotedTextHtml("<script>x</script>")).not.toContain("<script>");
    expect(quotedTextHtml("   ")).toBe("");
  });

  it("render the closed email", () => {
    const out = previewTemplate(DEFAULT_TEMPLATES_BY_LOCALE.de.ticket_closed, { vars: { ref: "INC-0001", title: "Drucker", requesterName: "Erika" } });
    expect(out.subject).toBe("[INC-0001] Geschlossen: Drucker");
    expect(out.html).toContain("Hallo Erika");
  });
});
