import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import { PROCESSED_KEYWORD, retentionPlan, sameFolder, supportsCustomKeywords } from "./disposition";
import type { InboundConfig, ParsedInboundMail } from "./types";

/**
 * Poll a mailbox over IMAP for UNSEEN messages, parse each to a ParsedInboundMail,
 * and hand it to `onMail`. A message is disposed of (flagged \Seen, moved or
 * deleted — `config.disposition`) only after `onMail` resolves, so a crash
 * mid-processing leaves the mail to be retried on the next poll (the processor
 * dedupes on Message-ID, so a double delivery is harmless).
 *
 * Node-only (net/tls). Never import from a client component.
 */
export async function pollImap(
  settings: InboundConfig,
  onMail: (mail: ParsedInboundMail) => Promise<void>,
): Promise<{ processed: number; failed: number }> {
  const folder = settings.folder || "INBOX";
  // Moving into the polled folder itself would be a no-op at best: treat it as "seen".
  const config: InboundConfig =
    settings.disposition === "move" && sameFolder(settings.processedFolder, folder) ? { ...settings, disposition: "seen" } : settings;
  const client = connectClient(config);
  let processed = 0;
  let failed = 0;

  await client.connect();
  try {
    if (config.disposition === "move") await ensureFolder(client, config.processedFolder);
    const lock = await client.getMailboxLock(folder);
    try {
      const keywordSupported = supportsCustomKeywords(client.mailbox ? client.mailbox.permanentFlags : undefined);
      // Collect UIDs first so flag changes during iteration don't disturb the set.
      const uids: number[] = [];
      for await (const msg of client.fetch({ seen: false }, { uid: true })) {
        uids.push(msg.uid);
      }
      for (const uid of uids) {
        try {
          const { content } = await client.download(String(uid), undefined, { uid: true });
          const raw = await streamToBuffer(content);
          const mail = await parseRaw(raw);
          await onMail(mail);
        } catch {
          failed++;
          continue; // Leave it UNSEEN — it'll be retried next poll.
        }
        await dispose(client, uid, config, keywordSupported);
        processed++;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return { processed, failed };
}

/** Servers advertise extensions in upper case; imapflow keeps them in `capabilities`. */
export function hasCapability(client: ImapFlow, name: string): boolean {
  return client.capabilities?.has(name) === true;
}

const warned = new Set<string>();
/** One warning per kind per process: a mailbox without an extension would otherwise log on every message. */
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[servio:inbound] ${message}`);
}

/**
 * Remove messages by UID. Without UIDPLUS (RFC 4315) the only expunge a server
 * offers is a plain EXPUNGE, which also removes every OTHER \Deleted message in
 * the mailbox (mail a person flagged in a client) — so we refuse rather than risk it.
 */
async function deleteByUid(client: ImapFlow, range: string | number[]): Promise<boolean> {
  if (!hasCapability(client, "UIDPLUS")) {
    warnOnce("no-uidplus", "the server lacks UIDPLUS: deleting messages is skipped, they are only marked as read.");
    return false;
  }
  return Boolean(await client.messageDelete(range, { uid: true }));
}

/**
 * Move one message. With the MOVE extension that is one atomic command. Without
 * it imapflow would copy and then delete even when the copy failed (losing the
 * message), so the two steps are done here and the delete only follows a copy
 * that succeeded.
 */
async function moveByUid(client: ImapFlow, range: string, destination: string): Promise<boolean> {
  if (hasCapability(client, "MOVE")) return Boolean(await client.messageMove(range, destination, { uid: true }));
  const copied = await client.messageCopy(range, destination, { uid: true });
  if (!copied) return false;
  return deleteByUid(client, range);
}

/**
 * What happens to a processed message on the server. A failed move or delete
 * falls back to \Seen, so the message is never fetched (and processed) again.
 */
export async function dispose(client: ImapFlow, uid: number, config: InboundConfig, keywordSupported: boolean): Promise<void> {
  const range = String(uid);
  const seenFlags = keywordSupported ? ["\\Seen", PROCESSED_KEYWORD] : ["\\Seen"];
  try {
    if (config.disposition === "delete") {
      if (await deleteByUid(client, range)) return;
    } else if (config.disposition === "move") {
      await client.messageFlagsAdd(range, seenFlags, { uid: true });
      if (await moveByUid(client, range, config.processedFolder)) return;
    } else {
      await client.messageFlagsAdd(range, seenFlags, { uid: true });
      return;
    }
    console.error(`[servio:inbound] could not ${config.disposition} message ${uid}; it stays in the folder as read.`);
  } catch (e) {
    console.error(`[servio:inbound] could not ${config.disposition} message ${uid}:`, e instanceof Error ? e.message : e);
  }
  await client.messageFlagsAdd(range, seenFlags, { uid: true }).catch((e: unknown) => {
    console.error(`[servio:inbound] could not mark message ${uid} as read:`, e instanceof Error ? e.message : e);
  });
}

/**
 * Create the folder processed mail is moved to, unless it exists (mailboxCreate
 * reports that, not an error). A failure only logs: the moves then fall back to
 * \Seen, so polling keeps working while the folder setting is fixed.
 */
async function ensureFolder(client: ImapFlow, folder: string): Promise<void> {
  await client.mailboxCreate(folder).catch((e: unknown) => {
    console.error(`[servio:inbound] could not create folder "${folder}":`, e instanceof Error ? e.message : e);
  });
}

/**
 * Retention sweep: delete processed messages older than `config.retentionDays`
 * (see retentionPlan for which ones). Returns how many were deleted.
 */
export async function purgeImap(config: InboundConfig, now: Date = new Date()): Promise<number> {
  if (config.retentionDays <= 0 || config.disposition === "delete") return 0;
  const client = connectClient(config);
  await client.connect();
  try {
    return await sweepRetention(client, config, now);
  } finally {
    await client.logout().catch(() => {});
  }
}

/** The sweep on an open connection (separate from purgeImap so tests can drive it with a stub). */
export async function sweepRetention(client: ImapFlow, config: InboundConfig, now: Date): Promise<number> {
  // retentionPlan decides WHICH mailbox is swept: the processed folder in move
  // mode, the polled folder (keyword-marked mail only) otherwise. So it gets the
  // POLLED folder as `folder` — never the target, or the move case could not tell
  // the two apart.
  const base = {
    disposition: config.disposition,
    folder: config.folder || "INBOX",
    processedFolder: config.processedFolder,
    days: config.retentionDays,
    now,
  };
  const target = retentionPlan({ ...base, keywordSupported: true });
  if (!target) return 0;
  if (!hasCapability(client, "UIDPLUS")) {
    warnOnce("no-uidplus-retention", `retention skipped: the server lacks UIDPLUS, so "${target.mailbox}" cannot be purged without touching other messages.`);
    return 0;
  }
  const lock = await client.getMailboxLock(target.mailbox);
  try {
    // Whether the keyword can be stored is only known once the mailbox is open.
    const plan = retentionPlan({
      ...base,
      keywordSupported: supportsCustomKeywords(client.mailbox ? client.mailbox.permanentFlags : undefined),
    });
    if (!plan) {
      console.warn(`[servio:inbound] retention skipped: the server cannot mark processed messages in "${target.mailbox}".`);
      return 0;
    }
    const uids = await client.search({ before: plan.before, ...(plan.keyword ? { keyword: plan.keyword } : {}) }, { uid: true });
    if (!uids || uids.length === 0) return 0;
    await deleteByUid(client, uids);
    return uids.length;
  } finally {
    lock.release();
  }
}

function connectClient(config: InboundConfig): ImapFlow {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    tls: { rejectUnauthorized: config.tlsRejectUnauthorized !== false },
    logger: false,
  });
}

/** Parse a raw RFC 5322 message into our transport-agnostic shape. */
export async function parseRaw(raw: Buffer | string): Promise<ParsedInboundMail> {
  const p = await simpleParser(raw);
  const headers: Record<string, string> = {};
  for (const [k, v] of p.headers) headers[k.toLowerCase()] = typeof v === "string" ? v : String((v as { text?: string })?.text ?? "");
  applyRawHeaders(headers, p.headerLines);

  const from = p.from?.value?.[0];
  const refs = p.references;
  return {
    fromEmail: (from?.address ?? "").toLowerCase(),
    fromName: from?.name || null,
    to: addrList(p.to),
    cc: addrList(p.cc),
    subject: p.subject ?? "",
    text: p.text ?? "",
    html: typeof p.html === "string" ? p.html : null,
    messageId: p.messageId ?? null,
    inReplyTo: p.inReplyTo ?? null,
    references: Array.isArray(refs) ? refs : refs ? [refs] : [],
    date: p.date ?? null,
    headers,
    attachments: (p.attachments ?? [])
      .filter((a) => a.content && (a.contentDisposition !== "inline" || a.filename))
      .map((a) => ({
        filename: a.filename || "attachment",
        content: a.content as Buffer,
        contentType: a.contentType,
      })),
  };
}

/**
 * mailparser structures a few headers into objects whose `.text` is empty: all
 * `List-*` headers are folded into one `list` object and `Return-Path` is parsed
 * as an address, so the bounce marker `<>` becomes "". The loop-safety checks
 * (policy.ts isMachineMail) need the raw values, so they are read from the header
 * lines instead. `Authentication-Results` (added by the receiving server, one line
 * per hop) is kept the same way, one value per line (policy.ts isSenderAuthenticated).
 */
const RAW_HEADER = /^(list-[a-z-]+|return-path|authentication-results)$/;
export function applyRawHeaders(headers: Record<string, string>, lines: readonly { key: string; line: string }[] | undefined): void {
  if (!lines) return;
  delete headers["list"];
  const seen = new Set<string>();
  for (const { key, line } of lines) {
    if (!RAW_HEADER.test(key)) continue;
    // "Key: value" with folded continuation lines → one trimmed line.
    const value = line.slice(line.indexOf(":") + 1).replace(/\r?\n[ \t]+/g, " ").trim();
    // The structured value mailparser put there is replaced by the first raw one.
    const joiner = key === "authentication-results" ? "\n" : ", ";
    headers[key] = seen.has(key) ? `${headers[key]}${joiner}${value}` : value;
    seen.add(key);
  }
}

function addrList(obj: AddressObject | AddressObject[] | undefined): string[] {
  if (!obj) return [];
  const arr = Array.isArray(obj) ? obj : [obj];
  const out: string[] = [];
  for (const a of arr) for (const v of a.value ?? []) if (v.address) out.push(v.address.toLowerCase());
  return out;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
