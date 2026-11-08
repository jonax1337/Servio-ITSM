import { marked } from "marked";
import { sanitizeCommentHtml } from "@/lib/markdown";
import type { Locale } from "@/lib/i18n/config";

/**
 * Deliberately minimal email rendering. A ticket email should read like a normal
 * person's email — just the message — NOT a branded notification with a logo,
 * badges, buttons and a footer. Threading headers (In-Reply-To/References) keep
 * the conversation together in the recipient's client, so we don't re-quote the
 * whole history into the body either. Light HTML + a plaintext twin, nothing else.
 */

/** `locale`: the recipient's language for built-in template wording (see mailBrand in lib/mail.ts). */
export type MailBrand = { appName?: string; appUrl?: string; locale?: Locale };

/** Wrap already-safe content HTML in a bare, well-behaved email body. */
export function renderEmailHtml(opts: { contentHtml: string }): string {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#ffffff;">` +
    `<div style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111827;">${opts.contentHtml}</div>` +
    `</body></html>`
  );
}

/** Turn a plaintext block into safe paragraph HTML (blank line = new paragraph). */
export function textToHtmlParagraphs(text: string): string {
  return (text ?? "")
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;">${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** A normal email quote (left rule, muted) — used for forwards/context, not replies. */
export function quoteHtml(inner: string): string {
  return `<blockquote style="margin:10px 0;padding:0 0 0 12px;border-left:2px solid #D7E0EC;color:#5D6C80;">${inner}</blockquote>`;
}

/** A plain signature block under an agent reply. */
export function signatureHtml(inner: string): string {
  return `<div style="margin:14px 0 0;color:#5D6C80;">${inner}</div>`;
}

/**
 * Quoted correspondence for a FORWARD (the external recipient isn't on the thread,
 * so they need the context). Regular replies do NOT use this — the mail client
 * already shows the conversation.
 */
export function renderThreadHistory(items: { author: string; dateLabel: string; html: string }[]): string {
  if (!items.length) return "";
  const rows = items
    .map(
      (m) =>
        `<div style="margin:12px 0 4px;color:#5D6C80;font-size:13px;">On ${escape(m.dateLabel)}, ${escape(m.author)} wrote:</div>` +
        `<blockquote style="margin:0;padding:0 0 0 12px;border-left:2px solid #D7E0EC;color:#5D6C80;">${m.html}</blockquote>`,
    )
    .join("");
  return `<div style="margin-top:16px;">${rows}</div>`;
}

/** Render markdown/plain agent text to sanitized inline HTML for an email body. */
export function richToEmailHtml(source: string): string {
  const raw = marked.parse(source ?? "", { async: false }) as string;
  return sanitizeCommentHtml(raw);
}

function escape(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
