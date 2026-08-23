import { db } from "@/lib/db";
import { storage, buildStorageKey } from "@/lib/storage";
import { sanitizeFilename, MAX_UPLOAD_BYTES } from "@/lib/files";
import { sanitizeCommentHtml, htmlToText } from "@/lib/markdown";
import { recordInboundEmail } from "@/lib/mail";
import { getSetting } from "@/lib/settings";
import { parseTicketRef, ticketRef } from "@/lib/constants";
import { writeAudit, notify } from "@/lib/audit";
import { createTicketCore } from "@/lib/ticket-core";
import type { ParsedInboundMail } from "./types";

export type InboundResult =
  | { action: "skipped"; reason: string }
  | { action: "duplicate"; ticketId?: number }
  | { action: "created"; ticketId: number }
  | { action: "appended"; ticketId: number };

/**
 * Turn one received email into ticket activity. Transport-agnostic: IMAP poll and
 * (future) webhook both funnel here. Matching order — threading headers, then a
 * [INC-123] subject token, then plus-addressing — else a brand-new EMAIL ticket.
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
  const sender = await resolveSender(from, mail.fromName);
  if (!sender) return { action: "skipped", reason: "invalid sender address" };
  // Spoof guard: the inbound From is unauthenticated (no SPF/DKIM at this layer).
  // NEVER author a comment/ticket as a privileged (agent/admin) account — those
  // users act via the app, so an inbound mail from such an address is almost
  // certainly spoofed. Drop it rather than impersonate.
  if (sender.role !== "USER") return { action: "skipped", reason: "privileged sender" };
  const bodyHtml = mail.html ? sanitizeCommentHtml(mail.html) : null;
  const body = mail.text?.trim() || (bodyHtml ? htmlToText(bodyHtml) : "");

  const match = await matchTicket(mail, from);
  const ticketId = match?.ticketId ?? null;

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
    );
    const email = await recordInboundEmail({
      fromEmail: from,
      fromName: mail.fromName,
      toEmail: to[0] ?? smtpFrom ?? "",
      cc,
      subject: mail.subject,
      body,
      bodyHtml,
      messageId: mail.messageId,
      inReplyTo: mail.inReplyTo,
      references: mail.references.join(" ") || null,
      headers: mail.headers,
      ticketId: ticket.id,
    });
    await saveInboundAttachments(mail, { ticketId: ticket.id }, sender.id);
    await addCcParticipants(ticket.id, cc, sender.id);
    void email;
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

  const comment = await db.ticketComment.create({
    data: {
      ticketId,
      authorId: sender.id,
      body: body || "(empty message)",
      bodyHtml,
      isInternal,
      channel: "EMAIL",
      fromEmail: from,
    },
  });
  const email = await recordInboundEmail({
    fromEmail: from,
    fromName: mail.fromName,
    toEmail: to[0] ?? smtpFrom ?? "",
    cc,
    subject: mail.subject,
    body,
    bodyHtml,
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    references: mail.references.join(" ") || null,
    headers: mail.headers,
    ticketId,
    commentId: comment.id,
  });
  await db.ticketComment.update({ where: { id: comment.id }, data: { emailMessageId: email.id } });
  await saveInboundAttachments(mail, { commentId: comment.id }, sender.id);

  const t = await db.ticket.findUnique({ where: { id: ticketId }, select: { status: true, type: true, assigneeId: true, requesterId: true } });
  // Only a CUSTOMER reply reopens a resolved/closed ticket — a vendor's internal
  // note shouldn't. Otherwise just bump the activity timestamp.
  if (!isInternal && t && (t.status === "RESOLVED" || t.status === "CLOSED")) {
    await db.ticket.update({
      where: { id: ticketId },
      data: { status: "OPEN", resolvedAt: null, closedAt: null, resolveBreached: false, updatedAt: new Date() },
    });
  } else {
    await db.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
  }

  // Customer-side replies grow the participant list (portal access + future CC).
  // Vendor (internal) replies do not touch participants.
  if (!isInternal) {
    if (t && sender.id !== t.requesterId) await addParticipantUser(ticketId, sender.id);
    await addCcParticipants(ticketId, cc, sender.id);
  }

  // In-app notify: assignee + watchers (except the sender).
  const snippet = body.length > 160 ? `${body.slice(0, 157)}…` : body;
  const ref = ticketRef(ticketId, t?.type ?? "INC");
  const watchers = await db.ticketWatcher.findMany({ where: { ticketId }, select: { userId: true } });
  const recipients = new Set<string>(watchers.map((w) => w.userId));
  if (t?.assigneeId) recipients.add(t.assigneeId);
  recipients.delete(sender.id);
  await Promise.all(
    [...recipients].map((uid) =>
      notify(uid, { type: "COMMENT", title: `Email reply on ${ref}`, body: snippet, entity: "Ticket", entityId: String(ticketId) }),
    ),
  );
  await writeAudit({ userId: sender.id, action: "UPDATE", entity: "Ticket", entityId: ticketId, summary: "Email reply received" });

  return { action: "appended", ticketId };
}

// ── Matching ───────────────────────────────────────────────────────────────
type TicketMatch = { ticketId: number; corroborated: boolean };

async function matchTicket(mail: ParsedInboundMail, from: string): Promise<TicketMatch | null> {
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
      return { ticketId: row.ticketId, corroborated: await senderKnownToTicket(row.ticketId, from) };
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
    if (await senderKnownToTicket(id, from)) return { ticketId: id, corroborated: true };
  }
  return null;
}

/**
 * Corroborates a guessable (subject/plus) match: the sender must already be known
 * on the ticket — the requester, an existing participant, a notified contact, or a
 * prior outbound recipient. Blocks ticket hijacking by outsiders guessing numbers.
 */
async function senderKnownToTicket(ticketId: number, from: string): Promise<boolean> {
  const t = await db.ticket.findUnique({ where: { id: ticketId }, select: { requester: { select: { email: true } } } });
  if ((t?.requester?.email ?? "").toLowerCase() === from) return true;
  const part = await db.ticketParticipant.findFirst({ where: { ticketId, user: { email: from } }, select: { userId: true } });
  if (part) return true;
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
 * Find or create a lightweight USER contact by email (sender or CC party).
 * Returns null for malformed addresses. NEW contacts are created INACTIVE:
 * an unauthenticated inbound address is not a vetted portal account, so it must
 * not get an ACTIVE seat until an agent (or sign-up flow) confirms it. It can
 * still be a ticket requester/author/participant while inactive.
 */
async function resolveContact(email: string, name?: string | null) {
  const normalized = email.trim().toLowerCase();
  if (!isValidEmail(normalized)) return null;
  const existing = await db.user.findUnique({ where: { email: normalized } });
  if (existing) return existing;
  return db.user.create({
    data: { email: normalized, name: name || normalized.split("@")[0], role: "USER", isActive: false },
  });
}

async function resolveSender(email: string, name?: string | null) {
  return resolveContact(email, name);
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

async function saveInboundAttachments(
  mail: ParsedInboundMail,
  fk: { ticketId?: number; commentId?: string },
  uploaderId: string,
) {
  for (const a of mail.attachments) {
    if (!a.content?.length || a.content.length > MAX_UPLOAD_BYTES) continue;
    const safeName = sanitizeFilename(a.filename);
    const key = buildStorageKey(safeName);
    try {
      const put = await storage.put(key, a.content);
      await db.attachment.create({
        data: {
          filename: safeName,
          storageKey: key,
          checksum: put.checksum,
          mime: (a.contentType || "application/octet-stream").split(";")[0],
          size: put.size,
          uploadedById: uploaderId,
          ...fk,
        },
      });
    } catch {
      // Skip a single bad blob; keep the rest of the message intact.
    }
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
