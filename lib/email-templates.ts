import { db } from "@/lib/db";
import { htmlToText } from "@/lib/markdown";
import { renderEmailHtml, quoteHtml, textToHtmlParagraphs, type MailBrand } from "@/lib/mail-template";
import type { Locale } from "@/lib/i18n/config";
import { approvalStageDe, autoCloseNoticeDe, emailTemplatesDe, noticeLinkDe, noticeTextDe, surveyCtaDe } from "@/messages/emails/de";
import { createFormatter } from "@/lib/i18n/format";
import { noticeTextEn, type EmailNotice, type NoticeTextFn, type NoticeTicket } from "@/lib/notification-email-rules";

/**
 * Admin-editable email templates. Each is a SUBJECT + a BODY (HTML) with
 * {{placeholders}}. A DB row (EmailTemplate) overrides the built-in default; a
 * missing/disabled row falls back here so mail never breaks. Kept deliberately
 * plain — these read like normal emails, not branded notifications.
 *
 * Placeholders — text (auto-escaped): appName, ref, title, requesterName,
 * agentName, approverName, itemName, stage, autoCloseDays. HTML (inserted raw,
 * already sanitized): message, signature, quote, resolution, survey,
 * autoCloseNotice, details, comment, link.
 */

export const TEMPLATE_KEYS = [
  "ticket_received",
  "ticket_reply",
  "ticket_resolved",
  "ticket_participant",
  "ticket_assigned",
  "ticket_closed",
  "approval_request",
  "request_approved",
  "request_rejected",
  "notification",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const TEMPLATE_META: Record<TemplateKey, { label: string; description: string; vars: string[] }> = {
  ticket_received: { label: "Request received", description: "Short confirmation to the requester when a new ticket is created.", vars: ["appName", "ref", "requesterName"] },
  ticket_reply: { label: "Reply to requester", description: "Agent reply: message + signature + quoted trail ({{quote}}).", vars: ["ref", "title", "requesterName", "message", "signature", "quote"] },
  ticket_resolved: { label: "Ticket resolved", description: "Short note that the ticket was resolved, with the public resolution note ({{resolution}}), an optional CSAT survey link ({{survey}}) and, when resolved tickets close automatically, the delay ({{autoCloseDays}}) or a ready sentence about it ({{autoCloseNotice}}).", vars: ["ref", "title", "requesterName", "resolution", "autoCloseDays", "autoCloseNotice", "survey"] },
  ticket_participant: { label: "Added as participant", description: "When someone is added as a participant / CC'd.", vars: ["ref", "title", "requesterName", "agentName", "message"] },
  ticket_assigned: { label: "Ticket assigned", description: "Internal notice to the assigned agent.", vars: ["ref", "title", "agentName"] },
  ticket_closed: { label: "Ticket closed", description: "Note to the requester that the ticket was closed (by an agent or automatically). Only sent when it is switched on under Settings › Tickets.", vars: ["appName", "ref", "title", "requesterName"] },
  approval_request: { label: "Approval needed", description: "To the approver of a catalog request stage, with the request's answers ({{details}}) and, for multi-stage approvals, the stage ({{stage}}).", vars: ["appName", "ref", "title", "itemName", "requesterName", "approverName", "stage", "details"] },
  request_approved: { label: "Request approved", description: "To the requester when the last approval stage approved their catalog request, with the approver's comment ({{comment}}).", vars: ["ref", "title", "itemName", "requesterName", "comment"] },
  notification: { label: "Notification", description: "Email copy of an in-app notification (new unassigned ticket, requester reply, SLA, contracts and licenses, recurring tickets) for people who switched it on in their account settings. {{subject}}, {{message}} and {{details}} are written in the recipient's language; {{link}} opens the record.", vars: ["appName", "recipientName", "subject", "message", "details", "link"] },
  request_rejected: { label: "Request declined", description: "To the requester when their catalog request was declined, with the approver's comment ({{comment}}).", vars: ["ref", "title", "itemName", "requesterName", "comment"] },
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
      `{{autoCloseNotice}}` +
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
  ticket_closed: {
    subject: "[{{ref}}] Closed: {{title}}",
    bodyHtml:
      `<p>Hi {{requesterName}},</p>` +
      `<p>your request <strong>{{ref}}</strong> — "{{title}}" — is now <strong>closed</strong>. If you need anything else, just reply to this email or open a new request.</p>`,
  },
  approval_request: {
    subject: "[{{ref}}] Approval needed: {{itemName}}",
    bodyHtml:
      `<p>Hi {{approverName}},</p>` +
      `<p>{{requesterName}} has requested <strong>{{itemName}}</strong> ({{ref}}), which needs your approval{{stage}}.</p>` +
      `{{details}}` +
      `<p>Please approve or decline it in {{appName}} under Approvals.</p>`,
  },
  request_approved: {
    subject: "[{{ref}}] Your request was approved",
    bodyHtml:
      `<p>Hi {{requesterName}},</p>` +
      `<p>your request <strong>{{itemName}}</strong> ({{ref}}) has been approved and is now being worked on.</p>` +
      `{{comment}}`,
  },
  notification: {
    subject: "{{subject}}",
    bodyHtml:
      `<p>Hi {{recipientName}},</p>` +
      `<p>{{message}}</p>` +
      `{{details}}` +
      `{{link}}` +
      `<p>You get this email because of your notification settings in {{appName}} (Account settings › Notifications).</p>`,
  },
  request_rejected: {
    subject: "[{{ref}}] Your request was declined",
    bodyHtml:
      `<p>Hi {{requesterName}},</p>` +
      `<p>unfortunately your request <strong>{{itemName}}</strong> ({{ref}}) has been declined.</p>` +
      `{{comment}}` +
      `<p>If you still need it, you can submit a new request from the portal.</p>`,
  },
};

/**
 * Built-in defaults per language. English is DEFAULT_TEMPLATES; a language without its own
 * set falls back to English. An admin override (EmailTemplate row) is used as written for
 * every recipient. German lives in messages/emails/de.ts.
 */
export const DEFAULT_TEMPLATES_BY_LOCALE: Record<Locale, Record<TemplateKey, { subject: string; bodyHtml: string }>> = {
  en: DEFAULT_TEMPLATES,
  de: emailTemplatesDe,
};

const SURVEY_CTA: Record<Locale, { question: string; link: string }> = {
  en: { question: "How did we do?", link: "Rate our support" },
  de: surveyCtaDe,
};

const AUTO_CLOSE_NOTICE: Record<Locale, (days: number) => string> = {
  en: (days) => `If we don't hear from you, the ticket will be closed automatically in ${days} ${days === 1 ? "day" : "days"}.`,
  de: autoCloseNoticeDe,
};

const APPROVAL_STAGE: Record<Locale, (stage: number, of: number) => string> = {
  en: (stage, of) => ` (stage ${stage} of ${of})`,
  de: approvalStageDe,
};

/** The {{stage}} text of the approval email: empty for a single-stage approval. */
export function approvalStageText(stageIndex: number, stageCount: number, locale: Locale = "en"): string {
  if (stageCount <= 1) return "";
  return (APPROVAL_STAGE[locale] ?? APPROVAL_STAGE.en)(stageIndex + 1, stageCount);
}

const HTML_KEYS = new Set(["message", "signature", "quote", "resolution", "survey", "autoCloseNotice", "details", "comment", "link"]);

const NOTICE_TEXT: Record<Locale, NoticeTextFn> = { en: noticeTextEn, de: noticeTextDe };
const NOTICE_LINK: Record<Locale, (appName: string) => string> = {
  en: (appName) => `Open in ${appName}`,
  de: noticeLinkDe,
};

/** The {{autoCloseNotice}} paragraph of the resolved email (empty when automatic closing is off). */
export function autoCloseNoticeHtml(days: number, locale: Locale = "en"): string {
  if (days <= 0) return "";
  const sentence = (AUTO_CLOSE_NOTICE[locale] ?? AUTO_CLOSE_NOTICE.en)(days);
  return `<p>${escapeHtml(sentence)}</p>`;
}

/** A small "Rate our support" CTA block for the resolved email (empty string if no link). */
export function surveyCtaHtml(url?: string | null, locale: Locale = "en"): string {
  if (!url) return "";
  const safe = escapeHtml(url);
  const cta = SURVEY_CTA[locale] ?? SURVEY_CTA.en;
  return (
    `<p style="margin:16px 0 0;">${cta.question} ` +
    `<a href="${safe}" style="color:#3559E8;text-decoration:underline;">${cta.link}</a>` +
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

export async function getTemplate(key: TemplateKey, locale: Locale = "en"): Promise<{ subject: string; bodyHtml: string }> {
  try {
    const row = await db.emailTemplate.findUnique({ where: { key } });
    if (row && row.enabled && row.subject && row.bodyHtml) return { subject: row.subject, bodyHtml: row.bodyHtml };
  } catch {
    // table missing (pre-migration) → default
  }
  return (DEFAULT_TEMPLATES_BY_LOCALE[locale] ?? DEFAULT_TEMPLATES)[key];
}

export type RenderCtx = { brand?: MailBrand; vars: Record<string, string | undefined> };

/** Resolve a template (DB or default) and render the plain HTML email. */
export async function renderTicketEmail(key: TemplateKey, ctx: RenderCtx) {
  const tpl = await getTemplate(key, ctx.brand?.locale);
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
  /** Days until the ticket closes automatically (Settings › Tickets); 0 or omitted = off. */
  autoCloseDays?: number;
}) {
  const autoCloseDays = ctx.autoCloseDays ?? 0;
  return renderTicketEmail("ticket_resolved", {
    brand: ctx.brand,
    vars: {
      appName: ctx.brand?.appName ?? "Servio",
      ref: ctx.ref,
      title: ctx.title,
      requesterName: ctx.requesterName ?? "",
      resolution: ctx.resolutionNote ? quoteHtml(textToHtmlParagraphs(ctx.resolutionNote)) : "",
      autoCloseDays: autoCloseDays > 0 ? String(autoCloseDays) : "",
      autoCloseNotice: autoCloseNoticeHtml(autoCloseDays, ctx.brand?.locale),
      survey: surveyCtaHtml(ctx.surveyUrl, ctx.brand?.locale),
    },
  });
}

/** A free-text block (request answers, approver comment) as quoted HTML paragraphs; empty stays empty. */
export function quotedTextHtml(text?: string | null): string {
  const clean = (text ?? "").trim();
  return clean ? quoteHtml(textToHtmlParagraphs(clean)) : "";
}

/** The "Approval needed" email to the approver of a catalog request stage. */
export function renderApprovalRequestEmail(ctx: {
  brand?: MailBrand;
  ref: string;
  title: string;
  itemName: string;
  requesterName: string;
  approverName: string;
  stageIndex: number;
  stageCount: number;
  details?: string | null;
}) {
  return renderTicketEmail("approval_request", {
    brand: ctx.brand,
    vars: {
      appName: ctx.brand?.appName ?? "Servio",
      ref: ctx.ref,
      title: ctx.title,
      itemName: ctx.itemName,
      requesterName: ctx.requesterName,
      approverName: ctx.approverName,
      stage: approvalStageText(ctx.stageIndex, ctx.stageCount, ctx.brand?.locale),
      details: quotedTextHtml(ctx.details),
    },
  });
}

/** The decision email to the requester of a catalog request ("approved" or "declined"). */
export function renderRequestDecisionEmail(
  key: "request_approved" | "request_rejected",
  ctx: { brand?: MailBrand; ref: string; title: string; itemName: string; requesterName: string; comment?: string | null },
) {
  return renderTicketEmail(key, {
    brand: ctx.brand,
    vars: {
      appName: ctx.brand?.appName ?? "Servio",
      ref: ctx.ref,
      title: ctx.title,
      itemName: ctx.itemName,
      requesterName: ctx.requesterName,
      comment: quotedTextHtml(ctx.comment),
    },
  });
}

/** The "Ticket closed" email to the requester. */
export function renderTicketClosedEmail(ctx: { brand?: MailBrand; ref: string; title: string; requesterName: string }) {
  return renderTicketEmail("ticket_closed", {
    brand: ctx.brand,
    vars: { appName: ctx.brand?.appName ?? "Servio", ref: ctx.ref, title: ctx.title, requesterName: ctx.requesterName },
  });
}

/**
 * The "notification" email: an in-app notification's email copy, worded in the
 * recipient's language (`brand.locale`). `message` is text (escaped like every text
 * variable, even though the template treats it as HTML), `details` a quoted block.
 */
export function renderNotificationEmail(ctx: {
  brand?: MailBrand;
  recipientName: string;
  notice: EmailNotice;
  ticket?: NoticeTicket;
  /** Absolute link to the record; omitted when no public URL is configured. */
  url?: string | null;
}) {
  const locale = ctx.brand?.locale ?? "en";
  const appName = ctx.brand?.appName ?? "Servio";
  const f = createFormatter(locale);
  const text = (NOTICE_TEXT[locale] ?? NOTICE_TEXT.en)(ctx.notice, ctx.ticket ?? {}, (d) => f.date(d));
  const link = ctx.url
    ? `<p><a href="${escapeHtml(ctx.url)}" style="color:#3559E8;text-decoration:underline;">${escapeHtml((NOTICE_LINK[locale] ?? NOTICE_LINK.en)(appName))}</a></p>`
    : "";
  return renderTicketEmail("notification", {
    brand: ctx.brand,
    vars: {
      appName,
      recipientName: ctx.recipientName,
      subject: text.subject,
      message: escapeHtml(text.message),
      details: quotedTextHtml(text.details),
      link,
    },
  });
}

/** Preview render for the settings editor (uses the provided, unsaved body). */
export function previewTemplate(input: { subject: string; bodyHtml: string }, ctx: RenderCtx) {
  const subject = substitute(input.subject, ctx.vars, "text");
  const contentHtml = substitute(input.bodyHtml, ctx.vars, "html");
  return { subject, html: renderEmailHtml({ contentHtml }) };
}
