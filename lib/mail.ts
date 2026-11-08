import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { ticketRef } from "@/lib/constants";
import { getSetting } from "@/lib/settings";
import {
  renderEmailHtml, textToHtmlParagraphs, quoteHtml, richToEmailHtml, signatureHtml, renderThreadHistory,
  type MailBrand,
} from "@/lib/mail-template";
import { renderTicketEmail } from "@/lib/email-templates";
import { localeForUser } from "@/lib/i18n/instance";

/**
 * Pluggable mailer. If SMTP is configured it sends via nodemailer; otherwise it
 * runs in "outbox" mode (records the message as SENT so it can be previewed in
 * Settings › Mail). Every message is always recorded in the EmailMessage table,
 * which doubles as the durable, threadable mail history for a ticket.
 */

export async function smtpConfigured() {
  const [host, port] = await Promise.all([
    getSetting("SMTP_HOST"),
    getSetting("SMTP_PORT"),
  ]);
  return Boolean(host && port);
}

/** Domain used to mint RFC-2822 Message-IDs (derived from the From address). */
async function mailDomain(): Promise<string> {
  const from = (await getSetting("SMTP_FROM")) ?? "";
  const m = from.match(/@([A-Za-z0-9.-]+)/);
  return m?.[1] ?? "servio.local";
}

type SendInput = {
  to: string;
  toName?: string | null;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  body: string; // plaintext twin
  html?: string; // optional HTML variant (multipart/alternative)
  template?: string;
  entity?: string;
  entityId?: string | number;
  ticketId?: number;
  commentId?: string;
  /** Threading headers so replies stay in one conversation in the mail client. */
  inReplyTo?: string;
  references?: string;
  /** Stored blobs to attach (read from storage at send time). */
  attachments?: { filename: string; storageKey: string }[];
};

export async function sendMail(input: SendInput): Promise<void> {
  const domain = await mailDomain();
  // Mint a Message-ID up front so it lands both in the DB row and the wire header.
  const msg = await db.emailMessage.create({
    data: {
      direction: "OUTBOUND",
      toEmail: input.to,
      toName: input.toName ?? null,
      cc: input.cc?.length ? JSON.stringify(input.cc) : null,
      bcc: input.bcc?.length ? JSON.stringify(input.bcc) : null,
      replyTo: input.replyTo ?? null,
      subject: input.subject,
      body: input.body,
      bodyHtml: input.html ?? null,
      template: input.template ?? "generic",
      inReplyTo: input.inReplyTo ?? null,
      references: input.references ?? null,
      entity: input.entity,
      entityId: input.entityId != null ? String(input.entityId) : null,
      ticketId: input.ticketId ?? null,
      commentId: input.commentId ?? null,
      status: "QUEUED",
    },
  });
  const messageId = `<${msg.id}@${domain}>`;
  await db.emailMessage.update({ where: { id: msg.id }, data: { messageId } });

  try {
    if (await smtpConfigured()) {
      const [host, port, secure, user, pass, from] = await Promise.all([
        getSetting("SMTP_HOST"),
        getSetting("SMTP_PORT"),
        getSetting("SMTP_SECURE"),
        getSetting("SMTP_USER"),
        getSetting("SMTP_PASS"), // secret — stored encrypted, decrypted on read
        getSetting("SMTP_FROM"),
      ]);
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport({
        host: host ?? undefined,
        port: Number(port ?? 587),
        secure: secure === "true",
        auth: user ? { user, pass: pass ?? undefined } : undefined,
      });
      // Read stored blobs into stream attachments for nodemailer.
      const mailAttachments = input.attachments?.length
        ? await Promise.all(
            input.attachments.map(async (a) => ({ filename: a.filename, content: (await storage.get(a.storageKey)).body })),
          )
        : undefined;
      const headers: Record<string, string> = { "Message-ID": messageId };
      if (input.inReplyTo) headers["In-Reply-To"] = input.inReplyTo;
      if (input.references) headers["References"] = input.references;
      // Retry with exponential backoff so a transient SMTP blip (connection
      // reset, greylisting, brief timeout) doesn't permanently drop a
      // notification. The final failure still surfaces as FAILED below.
      await sendWithRetry(() =>
        transport.sendMail({
          from: from ?? "Servio <servio@localhost>",
          to: input.toName ? `${input.toName} <${input.to}>` : input.to,
          cc: input.cc?.length ? input.cc : undefined,
          bcc: input.bcc?.length ? input.bcc : undefined,
          replyTo: input.replyTo || undefined,
          subject: input.subject,
          text: input.body,
          html: input.html || undefined, // nodemailer builds multipart/alternative
          headers,
          attachments: mailAttachments,
        }),
      );
      await db.emailMessage.update({
        where: { id: msg.id },
        data: { status: "SENT", sentAt: new Date() },
      });
    } else {
      // No SMTP configured → simulated delivery. Marked distinctly (SIMULATED,
      // not SENT) so the outbox never claims an email actually left the system.
      await db.emailMessage.update({
        where: { id: msg.id },
        data: { status: "SIMULATED", sentAt: new Date() },
      });
    }
  } catch (e) {
    await db.emailMessage.update({
      where: { id: msg.id },
      data: { status: "FAILED", error: e instanceof Error ? e.message : String(e) },
    });
  }
}

/** Delays (ms) between send attempts — exponential backoff for transient SMTP faults. */
const SMTP_RETRY_DELAYS_MS = [500, 2000, 5000];

/**
 * Invoke `send` and, on failure, retry with exponential backoff. Rethrows the
 * last error after the final attempt so the caller records the row as FAILED.
 */
async function sendWithRetry(send: () => Promise<unknown>): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= SMTP_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await send();
      return;
    } catch (e) {
      lastErr = e;
      const delay = SMTP_RETRY_DELAYS_MS[attempt];
      if (delay == null) break; // exhausted retries
      console.warn(
        `[mail] SMTP send failed (attempt ${attempt + 1}/${SMTP_RETRY_DELAYS_MS.length + 1}); retrying in ${delay}ms:`,
        e instanceof Error ? e.message : String(e),
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Persist an INBOUND email as an EmailMessage row (the thread anchor for replies).
 * `messageId` is @unique, so a redelivered message collides — callers dedupe on it.
 */
export async function recordInboundEmail(input: {
  fromEmail: string;
  fromName?: string | null;
  toEmail: string;
  cc?: string[];
  subject: string;
  body: string;
  bodyHtml?: string | null;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  headers?: Record<string, unknown> | null;
  ticketId?: number | null;
  commentId?: string | null;
}) {
  return db.emailMessage.create({
    data: {
      direction: "INBOUND",
      status: "RECEIVED",
      fromEmail: input.fromEmail,
      fromName: input.fromName ?? null,
      toEmail: input.toEmail,
      cc: input.cc?.length ? JSON.stringify(input.cc) : null,
      subject: input.subject,
      body: input.body,
      bodyHtml: input.bodyHtml ?? null,
      messageId: input.messageId ?? null,
      inReplyTo: input.inReplyTo ?? null,
      references: input.references ?? null,
      headers: input.headers ? JSON.stringify(input.headers) : null,
      ticketId: input.ticketId ?? null,
      commentId: input.commentId ?? null,
      sentAt: new Date(),
    },
  });
}

/**
 * Build In-Reply-To / References for a reply on a ticket, so the outgoing mail
 * threads onto the existing conversation in the recipient's client. References =
 * the whole chain (root … last); In-Reply-To = the most recent message.
 */
export async function ticketThreadHeaders(
  ticketId: number,
): Promise<{ inReplyTo?: string; references?: string }> {
  const rows = await threadRows(ticketId);
  // Customer-facing mail must not reveal the vendor side of the ticket: our
  // forwards and the replies that came back as internal notes would otherwise
  // show up (by Message-ID domain) in the requester's References header.
  const internalCommentIds = new Set(
    (await db.ticketComment.findMany({
      where: { ticketId, isInternal: true, id: { in: rows.flatMap((r) => (r.commentId ? [r.commentId] : [])) } },
      select: { id: true },
    })).map((c) => c.id),
  );
  return threadHeadersFrom(
    rows.filter((r) => r.template !== FORWARD_TEMPLATE && !(r.commentId && internalCommentIds.has(r.commentId))),
  );
}

/** Thread headers for a forward to an external party: the whole chain, vendor side included. */
export async function forwardThreadHeaders(ticketId: number): Promise<{ inReplyTo?: string; references?: string }> {
  return threadHeadersFrom(await threadRows(ticketId));
}

export const FORWARD_TEMPLATE = "ticket_forward";

function threadRows(ticketId: number) {
  return db.emailMessage.findMany({
    where: { ticketId, messageId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { messageId: true, template: true, commentId: true },
  });
}

function threadHeadersFrom(rows: { messageId: string | null }[]): { inReplyTo?: string; references?: string } {
  const ids = rows.map((r) => r.messageId!).filter(Boolean);
  if (ids.length === 0) return {};
  return { inReplyTo: ids[ids.length - 1], references: ids.join(" ") };
}

// ── Templates ────────────────────────────────────────────────────────────
// Thin wrappers that assemble variables + shell config and defer wording to the
// admin-editable template engine (lib/email-templates.ts). The shell (badges,
// CTA, footer) stays code-controlled; subject/body are DB-editable per template.
type TicketLike = { id: number; title: string; type: string; prefix?: string | null; status: string };

/** The ticket's stable ref: the stored prefix survives a later type switch. */
const refOf = (t: TicketLike) => ticketRef(t.id, t.prefix || t.type);

/**
 * Brand + public origin for links, read from settings (APP_NAME / APP_URL), plus the
 * language of the built-in template wording: the recipient's `User.locale` when a
 * recipient is given, else (or for "auto") the instance default (APP_LOCALE).
 */
export async function mailBrand(recipient?: { locale?: string | null; email?: string | null } | null): Promise<MailBrand> {
  // A recipient given without its locale (e.g. a session user) is looked up by email.
  const withLocale =
    recipient && recipient.locale === undefined && recipient.email
      ? await db.user.findUnique({ where: { email: recipient.email }, select: { locale: true } }).catch(() => null)
      : recipient;
  const [appName, appUrl, locale] = await Promise.all([
    getSetting("APP_NAME"),
    getSetting("APP_URL"),
    localeForUser(withLocale),
  ]);
  return { appName: appName || "Servio", appUrl: appUrl || undefined, locale };
}

export function tplTicketReceived(t: TicketLike, brand?: MailBrand, opts?: { requesterName?: string; messageHtml?: string }) {
  return renderTicketEmail("ticket_received", {
    brand,
    vars: { appName: brand?.appName ?? "Servio", ref: refOf(t), title: t.title, requesterName: opts?.requesterName ?? "" },
  });
}

export function tplTicketAssigned(t: TicketLike, agentName: string, brand?: MailBrand) {
  return renderTicketEmail("ticket_assigned", {
    brand,
    vars: { appName: brand?.appName ?? "Servio", ref: refOf(t), title: t.title, agentName },
  });
}

export function tplTicketReply(
  t: TicketLike,
  opts: { requesterName?: string; messageHtml: string; signatureHtml?: string; quoteHtml?: string; snippet?: string },
  brand?: MailBrand,
) {
  return renderTicketEmail("ticket_reply", {
    brand,
    vars: {
      appName: brand?.appName ?? "Servio",
      ref: refOf(t),
      title: t.title,
      requesterName: opts.requesterName ?? "",
      message: opts.messageHtml,
      signature: opts.signatureHtml ?? "",
      quote: opts.quoteHtml ?? "",
    },
  });
}

export function tplTicketParticipant(t: TicketLike, name: string, addedBy: string, note: string, brand?: MailBrand) {
  return renderTicketEmail("ticket_participant", {
    brand,
    vars: {
      appName: brand?.appName ?? "Servio",
      ref: refOf(t),
      title: t.title,
      requesterName: name,
      agentName: addedBy,
      message: note ? quoteHtml(escapeInline(note)) : "",
    },
  });
}

// Re-export so callers can build ad-hoc HTML bodies (e.g. forwards) consistently.
export { renderEmailHtml, richToEmailHtml, textToHtmlParagraphs, quoteHtml, signatureHtml, renderThreadHistory };

function escapeInline(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
