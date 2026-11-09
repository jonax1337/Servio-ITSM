import { db } from "@/lib/db";
import { storage, buildStorageKey } from "@/lib/storage";
import { validateUpload } from "@/lib/files";
import { sanitizeCommentHtml, htmlToText } from "@/lib/markdown";
import { mailBrand, recordInboundEmail, sendMail } from "@/lib/mail";
import { renderInboundRejectedEmail } from "@/lib/email-templates";
import { getBoolSetting, getExtraUploadExtensions, getMaxUploadMb, getSetting } from "@/lib/settings";
import { parseTicketRef, ticketRef } from "@/lib/constants";
import { writeAudit } from "@/lib/audit";
import { findUserByAnyEmail } from "@/lib/user-emails";
import { createTicketCore, notifyAssigneeAndWatchers, reopenOnCustomerReply } from "@/lib/ticket-core";
import { isForwardedSubject, stripQuotedHtml, stripQuotedText } from "./reply-strip";
import {
  AUTO_ANSWER_COOLDOWN_HOURS,
  AUTO_ANSWER_MAX_PER_HOUR,
  INBOUND_ALLOWED_DOMAINS_SETTING,
  INBOUND_DENY_LIST_SETTING,
  INBOUND_REJECT_AUTOREPLY_SETTING,
  INBOUND_REJECT_REQUIRE_AUTH_SETTING,
  INBOUND_SENDER_POLICY_SETTING,
  decideSender,
  isMachineMail,
  isSenderAuthenticated,
  parseList,
  parseSenderPolicy,
  type InboundRejectReason,
} from "./policy";
import { skippedAttachmentsNote } from "./log-note";
import type { ParsedInboundMail } from "./types";

export type InboundResult =
  | { action: "skipped"; reason: string }
  | { action: "duplicate"; ticketId?: number }
  | { action: "rejected"; reason: InboundRejectReason; autoAnswered: boolean }
  | { action: "created"; ticketId: number }
  | { action: "appended"; ticketId: number };

/** Template key of the automatic answer to a rejected email (lib/email-templates.ts). */
const REJECT_ANSWER_TEMPLATE = "inbound_rejected";

/**
 * Turn one received email into ticket activity. Transport-agnostic: IMAP poll and
 * (future) webhook both funnel here. Matching order — threading headers, then a
 * [INC-123] subject token, then plus-addressing — else a brand-new EMAIL ticket,
 * if the inbound sender policy (lib/mail-inbound/policy.ts) lets the sender open one.
 */
export async function processInboundMail(mail: ParsedInboundMail): Promise<InboundResult> {
  // ── Guards: don't ingest auto-replies or our own outbound mail (loop safety) ──
  if (isAutoResponder(mail)) return { action: "skipped", reason: "auto-responder" };
  // Canonicalize addresses ONCE, up front. Everything downstream (self-loop check,
  // notified-contact lookup, sender/participant resolution, stored metadata) keys
  // off these — never off the raw header — so a mixed-case sender can't slip past
  // the notified check and leak internal vendor correspondence as a public comment.
  const from = (mail.fromEmail ?? "").trim().toLowerCase();
  if (!from) return { action: "skipped", reason: "no sender" };
  const cc = (mail.cc ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean);
  const to = (mail.to ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean);
  const smtpFrom = await getSetting("SMTP_FROM");
  if (smtpFrom && extractAddr(smtpFrom) === from) return { action: "skipped", reason: "self" };

  // Dedupe on Message-ID (schema-unique), so a redelivery is a no-op.
  if (mail.messageId) {
    const existing = await db.emailMessage.findUnique({
      where: { messageId: mail.messageId },
      select: { ticketId: true },
    });
    if (existing) return { action: "duplicate", ticketId: existing.ticketId ?? undefined };
  }

  if (!isValidEmail(from)) return { action: "skipped", reason: "invalid sender address" };
  // Primary or secondary address of an existing person; nobody is created yet, so
  // a message the policy turns away never mints a contact.
  const known = await findUserByAnyEmail(from, { id: true, name: true, role: true, isActive: true });
  // Spoof guard: the inbound From is unauthenticated (no SPF/DKIM at this layer).
  // NEVER author a comment/ticket as a privileged (agent/admin) account — those
  // users act via the app, so an inbound mail from such an address is almost
  // certainly spoofed. Drop it rather than impersonate.
  if (known && known.role !== "USER") return { action: "skipped", reason: "privileged sender" };
  const bodyHtml = mail.html ? sanitizeCommentHtml(mail.html) : null;
  const body = mail.text?.trim() || (bodyHtml ? htmlToText(bodyHtml) : "");
  const log = logFields(mail, { from, to, cc, smtpFrom, body, bodyHtml });

  const match = await matchTicket(mail, from, known?.id ?? null);
  const ticketId = match?.ticketId ?? null;

  // Only a NEW ticket is subject to the sender policy; a reply always lands.
  if (ticketId == null) {
    const decision = decideSender({ from, ...(await loadSenderPolicy()), isReply: false, knownActive: !!known?.isActive });
    if (!decision.accept) {
      await recordInboundEmail({ ...log, status: decision.reason === "denied" ? "ARCHIVED" : "REJECTED", error: decision.reason });
      const autoAnswered = decision.mayAutoAnswer && (await answerRejected(mail, from));
      return { action: "rejected", reason: decision.reason, autoAnswered };
    }
  }

  const sender = known ?? (await resolveContact(from, mail.fromName));
  if (!sender) return { action: "skipped", reason: "invalid sender address" };

  // ── No match → open a new ticket from the email ──
  if (ticketId == null) {
    const rawSubject = mail.subject?.trim() ?? "";
    const title = rawSubject.length >= 3 ? rawSubject : rawSubject ? `Email: ${rawSubject}` : "Email request";
    const ticket = await createTicketCore(
      {
        title,
        description: body,
        type: "INCIDENT",
        priority: "MEDIUM",
        impact: "MEDIUM",
        urgency: "MEDIUM",
        source: "EMAIL",
        requesterId: sender.id,
        requestedByUserId: null,
        assigneeId: null,
        groupId: null,
        categoryId: null,
        serviceId: null,
        slaId: null,
      },
      sender.id,
      mail.messageId,
    );
    const email = await recordInboundEmail({ ...log, ticketId: ticket.id });
    await saveInboundAttachments(mail, { ticketId: ticket.id }, sender.id, email.id);
    await addCcParticipants(ticket.id, cc, sender.id);
    return { action: "created", ticketId: ticket.id };
  }

  // ── Match → append the reply to the existing ticket ──
  // A reply FROM an external party we forwarded to ("notified") is internal
  // vendor correspondence — it must NOT show as a public, customer-facing comment.
  const notified = await db.ticketNotifiedContact.findUnique({
    where: { ticketId_email: { ticketId, email: from } },
    select: { id: true },
  });
  // A threading-header match alone does NOT prove the sender belongs on the ticket:
  // Message-IDs travel in forwarded/quoted mail and can be replayed by a third
  // party, so an uncorroborated threading match must not become a public,
  // customer-facing comment nor auto-seat a portal participant. Land it as an
  // internal note for agent triage instead. (Subject/plus matches are already
  // corroborated inside matchTicket, so those arrive with corroborated=true.)
  const isInternal = !!notified || !match!.corroborated;

  const reply = replyContent(mail, body);
  const comment = await db.ticketComment.create({
    data: {
      ticketId,
      authorId: sender.id,
      body: reply.text || "(empty message)",
      bodyHtml: reply.html,
      isInternal,
      channel: "EMAIL",
      fromEmail: from,
    },
  });
  const email = await recordInboundEmail({ ...log, ticketId, commentId: comment.id });
  await db.ticketComment.update({ where: { id: comment.id }, data: { emailMessageId: email.id } });
  await saveInboundAttachments(mail, { commentId: comment.id }, sender.id, email.id);

  const t = await db.ticket.findUnique({ where: { id: ticketId }, select: { type: true, prefix: true, requesterId: true } });
  // Only a CUSTOMER reply reopens a resolved/closed ticket — a vendor's internal
  // note shouldn't. Otherwise just bump the activity timestamp.
  if (isInternal) {
    await db.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
  } else {
    await reopenOnCustomerReply(ticketId, sender.id, reply.text);
  }

  // Customer-side replies grow the participant list (portal access + future CC).
  // Vendor (internal) replies do not touch participants.
  if (!isInternal) {
    if (t && sender.id !== t.requesterId) await addParticipantUser(ticketId, sender.id);
    await addCcParticipants(ticketId, cc, sender.id);
  }

  // In-app notify: assignee + watchers (except the sender).
  const snippet = reply.text.length > 160 ? `${reply.text.slice(0, 157)}…` : reply.text;
  const ref = ticketRef(ticketId, t?.prefix || t?.type || "INC");
  await notifyAssigneeAndWatchers(ticketId, sender.id, {
    type: "COMMENT", title: `Email reply on ${ref}`, body: snippet, entity: "Ticket", entityId: String(ticketId),
    ...(isInternal ? {} : { email: { kind: "REQUESTER_REPLY" as const, authorName: sender.name ?? from, snippet } }),
  });
  await writeAudit({ userId: sender.id, action: "UPDATE", entity: "Ticket", entityId: ticketId, summary: "Email reply received" });

  return { action: "appended", ticketId };
}

/** The inbound-log columns every recorded message shares (accepted or turned away). */
function logFields(
  mail: ParsedInboundMail,
  c: { from: string; to: string[]; cc: string[]; smtpFrom: string | null; body: string; bodyHtml: string | null },
) {
  return {
    fromEmail: c.from,
    fromName: mail.fromName,
    toEmail: c.to[0] ?? c.smtpFrom ?? "",
    cc: c.cc,
    subject: mail.subject,
    body: c.body,
    bodyHtml: c.bodyHtml,
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: mail.references.join(" ") || null,
    headers: mail.headers,
  };
}

async function loadSenderPolicy() {
  const [policy, allowed, denied] = await Promise.all([
    getSetting(INBOUND_SENDER_POLICY_SETTING),
    getSetting(INBOUND_ALLOWED_DOMAINS_SETTING),
    getSetting(INBOUND_DENY_LIST_SETTING),
  ]);
  return { policy: parseSenderPolicy(policy), allowedDomains: parseList(allowed), denyList: parseList(denied) };
}

/**
 * The optional automatic answer to an email the policy turned away, pointing the
 * sender to the portal. Loop-safe: never to machine/bulk mail, at most once per
 * address within AUTO_ANSWER_COOLDOWN_HOURS and AUTO_ANSWER_MAX_PER_HOUR in total.
 * The answer itself carries `Auto-Submitted: auto-replied`, so a well-behaved
 * responder stays silent.
 *
 * Backscatter: the From header of a rejected mail is exactly what cannot be
 * trusted (that is why it was rejected), so an answer can land at an innocent
 * third party. Three limits keep that small: the answer repeats nothing the
 * sender wrote (default template), the global hourly cap, and — unless the admin
 * switched it off — it only goes to a sender whose domain the mail server
 * authenticated (SPF/DKIM/DMARC in `Authentication-Results`).
 */
async function answerRejected(mail: ParsedInboundMail, from: string): Promise<boolean> {
  if (!(await getBoolSetting(INBOUND_REJECT_AUTOREPLY_SETTING, false))) return false;
  if (isMachineMail(mail.headers, from)) return false;
  if ((await getBoolSetting(INBOUND_REJECT_REQUIRE_AUTH_SETTING, true)) && !isSenderAuthenticated(mail.headers, from)) return false;
  const hour = 60 * 60 * 1000;
  const sentLastHour = await db.emailMessage.count({
    where: { direction: "OUTBOUND", template: REJECT_ANSWER_TEMPLATE, createdAt: { gte: new Date(Date.now() - hour) } },
  });
  if (sentLastHour >= AUTO_ANSWER_MAX_PER_HOUR) return false;
  const recent = await db.emailMessage.count({
    where: {
      direction: "OUTBOUND",
      template: REJECT_ANSWER_TEMPLATE,
      toEmail: from,
      createdAt: { gte: new Date(Date.now() - AUTO_ANSWER_COOLDOWN_HOURS * hour) },
    },
  });
  if (recent > 0) return false;

  const brand = await mailBrand();
  const portalUrl = brand.appUrl ? `${brand.appUrl.replace(/\/+$/, "")}/portal` : null;
  const rendered = await renderInboundRejectedEmail({
    brand,
    senderName: plainText(mail.fromName || from.split("@")[0]),
    subject: plainText(mail.subject ?? ""),
    portalUrl,
  });
  await sendMail({
    to: from,
    toName: mail.fromName,
    subject: rendered.subject,
    body: rendered.body,
    html: rendered.html,
    template: REJECT_ANSWER_TEMPLATE,
    inReplyTo: mail.messageId ?? undefined,
    references: mail.messageId ?? undefined,
    headers: { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" },
  });
  return true;
}

/** Attacker-written text that is echoed back (a custom template may use it): no control characters, bounded. */
function plainText(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 80);
}

/**
 * What lands in the ticket comment for a reply: the sender's own words without
 * the quoted conversation (forwards keep everything). Stripping runs on the RAW
 * html because the sanitizer removes the quote markers; the result is sanitized
 * afterwards. `fullText` is the unstripped plaintext used for the mail log.
 */
function replyContent(mail: ParsedInboundMail, fullText: string): { text: string; html: string | null } {
  if (isForwardedSubject(mail.subject)) {
    return { text: fullText, html: mail.html ? sanitizeCommentHtml(mail.html) : null };
  }
  const rawText = mail.text?.trim() ?? "";
  const text = rawText ? stripQuotedText(rawText) : null;
  // The text twin decides: only when it shows trailing history (something was cut)
  // is the html quote container safe to drop — inline answers sit inside it.
  const stripHtml = text === null || text !== rawText;
  const html = mail.html ? sanitizeCommentHtml(stripHtml ? stripQuotedHtml(mail.html) : mail.html) : null;
  return { text: text ?? (html ? htmlToText(html) : fullText), html };
}

// ── Matching ───────────────────────────────────────────────────────────────
type TicketMatch = { ticketId: number; corroborated: boolean };

async function matchTicket(mail: ParsedInboundMail, from: string, senderId: string | null): Promise<TicketMatch | null> {
  // 1. Threading headers → our own outbound Message-ID → its ticket. A header
  //    match links the mail to the right conversation, but it does NOT prove the
  //    SENDER belongs there: In-Reply-To/References ride along in forwarded and
  //    quoted mail, so a third party can carry (or replay) them. We still return
  //    the match — the reply is genuinely about that ticket — but flag whether the
  //    sender is corroborated (known on the ticket). Uncorroborated matches are
  //    landed as internal triage notes by the caller (no public comment, no seat).
  const refs = [mail.inReplyTo, ...mail.references].filter(Boolean) as string[];
  if (refs.length) {
    const row = await db.emailMessage.findFirst({
      where: { messageId: { in: refs }, ticketId: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { ticketId: true },
    });
    if (row?.ticketId) {
      return { ticketId: row.ticketId, corroborated: await senderKnownToTicket(row.ticketId, from, senderId) };
    }
  }
  // 2/3. Subject token ("Re: [INC-0042] …") and plus-addressing are GUESSABLE, so a
  //      match is only accepted when the sender is ALREADY known on that ticket —
  //      otherwise an outsider could inject into (and gain portal access to)
  //      arbitrary tickets just by guessing the number. Uncorroborated → new ticket.
  const candidates: number[] = [];
  const subjectRef = parseTicketRef(mail.subject);
  if (subjectRef) { const id = await verifyTicket(subjectRef); if (id) candidates.push(id); }
  for (const addr of [...mail.to, ...mail.cc]) {
    if (!addr.includes("+")) continue;
    const ref = parseTicketRef(addr.split("@")[0]);
    if (ref) { const id = await verifyTicket(ref); if (id) candidates.push(id); }
  }
  for (const id of candidates) {
    // These paths are only accepted when corroborated, so the match is always trusted.
    if (await senderKnownToTicket(id, from, senderId)) return { ticketId: id, corroborated: true };
  }
  return null;
}

/**
 * Corroborates a guessable (subject/plus) match: the sender must already be known
 * on the ticket — the requester, an existing participant, a notified contact, or a
 * prior outbound recipient. Blocks ticket hijacking by outsiders guessing numbers.
 * `senderId` is the person `from` belongs to by primary OR secondary address, so a
 * requester writing from a second mailbox is recognised.
 */
async function senderKnownToTicket(ticketId: number, from: string, senderId: string | null): Promise<boolean> {
  if (senderId) {
    const t = await db.ticket.findUnique({ where: { id: ticketId }, select: { requesterId: true } });
    if (t?.requesterId === senderId) return true;
    const part = await db.ticketParticipant.findUnique({
      where: { ticketId_userId: { ticketId, userId: senderId } },
      select: { userId: true },
    });
    if (part) return true;
  }
  const notified = await db.ticketNotifiedContact.findUnique({ where: { ticketId_email: { ticketId, email: from } }, select: { id: true } });
  if (notified) return true;
  // Prior outbound recipient (To or Cc). `cc` is a JSON array string, so compare
  // against the EXACT parsed addresses — never a substring of the serialized list
  // (a substring match would let "hef@x.com" corroborate against "chef@x.com").
  const rows = await db.emailMessage.findMany({
    where: { ticketId, direction: "OUTBOUND" },
    select: { toEmail: true, cc: true },
  });
  return rows.some((r) => {
    if ((r.toEmail ?? "").toLowerCase() === from) return true;
    if (!r.cc) return false;
    try {
      const list = JSON.parse(r.cc) as unknown;
      return Array.isArray(list) && list.some((e) => String(e).toLowerCase() === from);
    } catch {
      return false;
    }
  });
}

async function verifyTicket(ref: { id: number; prefix: string }): Promise<number | null> {
  const t = await db.ticket.findUnique({ where: { id: ref.id }, select: { id: true, prefix: true } });
  if (!t) return null;
  // Guard against a stray number matching the wrong entity: the prefix must agree
  // (legacy rows without a stored prefix are accepted).
  if (t.prefix && t.prefix !== ref.prefix) return null;
  return t.id;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Conservative RFC-5322-ish address check. We only accept a syntactically valid
 * single address (local@domain, a dot-bearing domain, no spaces/commas/angle
 * brackets) before minting a contact — so spam/typo garbage in From/Cc never
 * becomes a persisted user row.
 */
function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  return /^[^\s@,<>"]+@[^\s@,<>"]+\.[^\s@,<>"]+$/.test(email);
}

/**
 * Find (by primary or secondary address) or create a lightweight USER contact by
 * email (sender or CC party). Returns null for malformed addresses. NEW contacts
 * are created INACTIVE: an unauthenticated inbound address is not a vetted portal
 * account, so it must not get an ACTIVE seat until an agent (or sign-up flow)
 * confirms it. It can still be a ticket requester/author/participant while inactive.
 */
async function resolveContact(email: string, name?: string | null) {
  const normalized = email.trim().toLowerCase();
  if (!isValidEmail(normalized)) return null;
  const select = { id: true, name: true, role: true, isActive: true } as const;
  const existing = await findUserByAnyEmail(normalized, select);
  if (existing) return existing;
  return db.user.create({
    data: { email: normalized, name: name || normalized.split("@")[0], role: "USER", isActive: false },
    select,
  });
}

/** Add a user as a portal-visible participant (idempotent). */
async function addParticipantUser(ticketId: number, userId: string) {
  await db.ticketParticipant.upsert({
    where: { ticketId_userId: { ticketId, userId } },
    create: { ticketId, userId },
    update: {},
  });
}

/**
 * Everyone CC'd on a CUSTOMER-side inbound mail becomes a ticket PARTICIPANT
 * (portal-visible, kept on future replies). Unknown addresses are created as
 * contacts. Addresses that are external "notified" forward-contacts are skipped —
 * they must not gain portal access.
 */
async function addCcParticipants(ticketId: number, cc: string[], exclude: string) {
  for (const addr of cc) {
    if (!isValidEmail(addr)) continue;
    const notified = await db.ticketNotifiedContact.findUnique({
      where: { ticketId_email: { ticketId, email: addr.toLowerCase() } },
      select: { id: true },
    });
    if (notified) continue;
    const user = await resolveContact(addr);
    if (!user || user.id === exclude) continue;
    await addParticipantUser(ticketId, user.id);
  }
}

/**
 * Store the mail's attachments under the same rules as an upload (size cap,
 * allow-list incl. admin-added extensions, magic bytes, hard deny-list). Files
 * that fail are not stored; their names are noted on the inbound log row so an
 * agent can ask for them another way.
 */
async function saveInboundAttachments(
  mail: ParsedInboundMail,
  fk: { ticketId?: number; commentId?: string },
  uploaderId: string,
  emailMessageId: string,
) {
  const [maxMb, extraExtensions] = await Promise.all([getMaxUploadMb(), getExtraUploadExtensions()]);
  const skipped: string[] = [];
  for (const a of mail.attachments) {
    const v = validateUpload(a.filename, a.contentType ?? "", a.content ?? Buffer.alloc(0), maxMb * 1024 * 1024, extraExtensions);
    if (!v.ok) {
      skipped.push(a.filename);
      continue;
    }
    const key = buildStorageKey(v.safeName);
    try {
      const put = await storage.put(key, a.content);
      await db.attachment.create({
        data: { filename: v.safeName, storageKey: key, checksum: put.checksum, mime: v.mime, size: put.size, uploadedById: uploaderId, ...fk },
      });
    } catch (e) {
      // Keep the rest of the message intact; the log row names what is missing.
      console.error(`[servio:inbound] could not store attachment "${a.filename}":`, e instanceof Error ? e.message : e);
      await storage.delete(key).catch(() => {});
      skipped.push(a.filename);
    }
  }
  if (skipped.length) {
    await db.emailMessage.update({ where: { id: emailMessageId }, data: { error: skippedAttachmentsNote(skipped) } });
  }
}

function isAutoResponder(mail: ParsedInboundMail): boolean {
  const h = mail.headers;
  const autoSubmitted = (h["auto-submitted"] ?? "").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (h["x-autoreply"] || h["x-autorespond"] || h["x-auto-response-suppress"]) return true;
  const precedence = (h["precedence"] ?? "").toLowerCase();
  if (["bulk", "auto_reply", "junk", "list"].includes(precedence)) return true;
  return false;
}

function extractAddr(s: string): string {
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}
