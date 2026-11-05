import { db } from "@/lib/db";
import { htmlToText } from "@/lib/markdown";
import { renderEmailHtml, quoteHtml, textToHtmlParagraphs, type MailBrand } from "@/lib/mail-template";

/**
 * Admin-editable email templates. Each is a SUBJECT + a BODY (HTML) with
 * {{placeholders}}. A DB row (EmailTemplate) overrides the built-in default; a
 * missing/disabled row falls back here so mail never breaks. Kept deliberately
 * plain — these read like normal emails, not branded notifications.
 *
 * Placeholders — text (auto-escaped): appName, ref, title, requesterName,
 * agentName. HTML (inserted raw, already sanitized): message, signature.
 */

export const TEMPLATE_KEYS = [
  "ticket_received",
  "ticket_reply",
  "ticket_resolved",
  "ticket_participant",
  "ticket_assigned",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const TEMPLATE_META: Record<TemplateKey, { label: string; description: string; vars: string[] }> = {
  ticket_received: { label: "Request received", description: "Short confirmation to the requester when a new ticket is created.", vars: ["appName", "ref", "requesterName"] },
  ticket_reply: { label: "Reply to requester", description: "Agent reply: message + signature + quoted trail ({{quote}}).", vars: ["ref", "title", "requesterName", "message", "signature", "quote"] },
  ticket_resolved: { label: "Ticket resolved", description: "Short note that the ticket was resolved, with the public resolution note ({{resolution}}) and an optional CSAT survey link ({{survey}}).", vars: ["ref", "title", "requesterName", "resolution", "survey"] },
  ticket_participant: { label: "Added as participant", description: "When someone is added as a participant / CC'd.", vars: ["ref", "title", "requesterName", "agentName", "message"] },
  ticket_assigned: { label: "Ticket assigned", description: "Internal notice to the assigned agent.", vars: ["ref", "title", "agentName"] },
};

export const DEFAULT_TEMPLATES: Record<TemplateKey, { subject: string; bodyHtml: string }> = {
  ticket_received: {
    subject: "[{{ref}}] We received your request",
    bodyHtml:
      `<p>Hi {{requesterName}},</p>` +
      `<p>thanks for your message — we've logged your request as <strong>{{ref}}</strong> and will get back to you as soon as possible.</p>` +
      `<p>You can reply to this email at any time.</p>`,
  },
  ticket_reply: {
    // The agent's message + signature, then the quoted conversation trail
    // ({{quote}}) — like a mail client. {{quote}} is empty when nothing to quote.
    subject: "[{{ref}}] {{title}}",
    bodyHtml: `{{message}}{{signature}}{{quote}}`,
  },
  ticket_resolved: {
    subject: "[{{ref}}] Resolved: {{title}}",
    bodyHtml:
      `<p>Hi {{requesterName}},</p>` +
      `<p>good news — your request <strong>{{ref}}</strong> has been marked as <strong>resolved</strong>. If anything is still open, just reply to this email.</p>` +
      `{{resolution}}` +
      `{{survey}}`,
  },
  ticket_participant: {
    subject: "[{{ref}}] You were added to a ticket",
    bodyHtml:
      `<p>Hi {{requesterName}},</p>` +
      `<p>{{agentName}} added you to <strong>{{ref}}</strong> — "{{title}}". You'll now receive updates and can reply to this email.</p>` +
      `{{message}}`,
  },
  ticket_assigned: {
    subject: "[{{ref}}] Assigned to you: {{title}}",
    bodyHtml:
      `<p>Hi {{agentName}},</p>` +
      `<p>ticket <strong>{{ref}}</strong> — "{{title}}" — has been assigned to you. Please take a look and take the next step.</p>`,
  },
};

const HTML_KEYS = new Set(["message", "signature", "quote", "resolution", "survey"]);

/** A small "Rate our support" CTA block for the resolved email (empty string if no link). */
export function surveyCtaHtml(url?: string | null): string {
  if (!url) return "";
  const safe = escapeHtml(url);
  return (
    `<p style="margin:16px 0 0;">How did we do? ` +
    `<a href="${safe}" style="color:#3559E8;text-decoration:underline;">Rate our support</a>` +
    `</p>`
  );
}

function escapeHtml(s: string) {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Substitute {{key}} tokens. In `html` mode text values are escaped and HTML_KEYS
 *  inserted raw; in `text` mode everything is plain (for the subject line). */
function substitute(tpl: string, vars: Record<string, string | undefined>, mode: "html" | "text"): string {
  return (tpl ?? "").replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = vars[k];
    if (v == null) return "";
    if (mode === "text") return String(v);
    return HTML_KEYS.has(k) ? String(v) : escapeHtml(String(v));
  });
}

export async function getTemplate(key: TemplateKey): Promise<{ subject: string; bodyHtml: string }> {
  try {
    const row = await db.emailTemplate.findUnique({ where: { key } });
    if (row && row.enabled && row.subject && row.bodyHtml) return { subject: row.subject, bodyHtml: row.bodyHtml };
  } catch {
    // table missing (pre-migration) → default
  }
  return DEFAULT_TEMPLATES[key];
}

export type RenderCtx = { brand?: MailBrand; vars: Record<string, string | undefined> };

/** Resolve a template (DB or default) and render the plain HTML email. */
export async function renderTicketEmail(key: TemplateKey, ctx: RenderCtx) {
  const tpl = await getTemplate(key);
  const subject = substitute(tpl.subject, ctx.vars, "text");
  const contentHtml = substitute(tpl.bodyHtml, ctx.vars, "html");
  return { template: key, subject, body: htmlToText(contentHtml), html: renderEmailHtml({ contentHtml }) };
}

/**
 * Render the "ticket_resolved" email with an optional CSAT survey link appended.
 * A thin wrapper over renderTicketEmail that injects the {{survey}} CTA — used by
 * the resolve hook so the survey link rides along with the resolution notice.
 */
export function renderTicketResolvedEmail(ctx: {
  brand?: MailBrand;
  ref: string;
  title: string;
  requesterName?: string;
  surveyUrl?: string | null;
  /** Public resolution note shown to the requester; omit for an internal note. */
  resolutionNote?: string | null;
}) {
  return renderTicketEmail("ticket_resolved", {
    brand: ctx.brand,
    vars: {
      appName: ctx.brand?.appName ?? "Servio",
      ref: ctx.ref,
      title: ctx.title,
      requesterName: ctx.requesterName ?? "",
      resolution: ctx.resolutionNote ? quoteHtml(textToHtmlParagraphs(ctx.resolutionNote)) : "",
      survey: surveyCtaHtml(ctx.surveyUrl),
    },
  });
}

/** Preview render for the settings editor (uses the provided, unsaved body). */
export function previewTemplate(input: { subject: string; bodyHtml: string }, ctx: RenderCtx) {
  const subject = substitute(input.subject, ctx.vars, "text");
  const contentHtml = substitute(input.bodyHtml, ctx.vars, "html");
  return { subject, html: renderEmailHtml({ contentHtml }) };
}
