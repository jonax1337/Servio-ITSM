// Pure rules for what happens to a fetched message on the IMAP server after
// Servio processed it, and which messages the retention sweep removes later.
// imap.ts executes these plans; tests/unit/inbound-disposition.test.ts pins them.

/**
 *   seen   — flag \Seen and leave it in the polled folder (the historical behaviour)
 *   move   — move it to a dedicated folder (created when missing)
 *   delete — delete it right away
 */
export const INBOUND_DISPOSITIONS = ["seen", "move", "delete"] as const;
export type InboundDisposition = (typeof INBOUND_DISPOSITIONS)[number];

export const IMAP_PROCESSED_ACTION_SETTING = "IMAP_PROCESSED_ACTION";
export const IMAP_PROCESSED_FOLDER_SETTING = "IMAP_PROCESSED_FOLDER";
export const IMAP_RETENTION_DAYS_SETTING = "IMAP_RETENTION_DAYS";
export const DEFAULT_PROCESSED_FOLDER = "Processed";
export const MAX_RETENTION_DAYS = 3650;

/**
 * IMAP keyword set on every message Servio processed. In "seen" mode it is the
 * only safe way to tell our messages from ones a person read in the mailbox
 * (which Servio never ingests): retention deletes only messages carrying it.
 */
export const PROCESSED_KEYWORD = "$ServioProcessed";

export function parseDisposition(raw: string | null | undefined): InboundDisposition {
  const v = (raw ?? "").trim().toLowerCase();
  return (INBOUND_DISPOSITIONS as readonly string[]).includes(v) ? (v as InboundDisposition) : "seen";
}

/** Whole days between 0 (off) and MAX_RETENTION_DAYS; anything else is null (invalid input). */
export function parseRetentionDays(raw: string | number | null | undefined): number | null {
  const s = String(raw ?? "").trim();
  if (s === "") return 0;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= MAX_RETENTION_DAYS ? n : null;
}

/** A folder name an IMAP server will accept: non-empty, no control characters, no wildcards. */
export function isValidFolderName(name: string): boolean {
  const v = name.trim();
  if (!v || v.length > 200) return false;
  for (const ch of v) {
    const c = ch.charCodeAt(0);
    if (c < 0x20 || c === 0x7f) return false;
  }
  return !/[*%]/.test(v);
}

export type RetentionPlan = {
  /** The mailbox the sweep opens. */
  mailbox: string;
  /** Messages received before this instant are deleted. */
  before: Date;
  /** Restrict to messages with PROCESSED_KEYWORD (seen mode, where the folder is shared with people). */
  keyword: string | null;
};

/**
 * Which messages the retention sweep deletes, or null when it has nothing to do:
 * retention is off, the messages are already deleted on processing, or the
 * polled folder is shared with people but the server cannot store our keyword.
 * In move mode the target folder holds only processed mail, so every message
 * older than the cutoff goes.
 */
export function retentionPlan(input: {
  disposition: InboundDisposition;
  folder: string;
  processedFolder: string;
  days: number;
  now: Date;
  keywordSupported: boolean;
}): RetentionPlan | null {
  if (input.days <= 0 || input.disposition === "delete") return null;
  const before = new Date(input.now.getTime() - input.days * 24 * 60 * 60 * 1000);
  // The move target holds only processed mail — unless it IS the polled folder.
  if (input.disposition === "move" && !sameFolder(input.processedFolder, input.folder)) {
    return { mailbox: input.processedFolder, before, keyword: null };
  }
  if (!input.keywordSupported) return null;
  return { mailbox: input.folder, before, keyword: PROCESSED_KEYWORD };
}

/** IMAP folder names are case-sensitive, except INBOX (RFC 3501 §5.1). */
export function sameFolder(a: string, b: string): boolean {
  const norm = (f: string) => (f.trim().toUpperCase() === "INBOX" ? "INBOX" : f.trim());
  return norm(a) === norm(b);
}

/** True when the mailbox lets clients store arbitrary keywords (PERMANENTFLAGS contains `\*`, or is not reported). */
export function supportsCustomKeywords(permanentFlags: Set<string> | undefined): boolean {
  return !permanentFlags || permanentFlags.has("\\*");
}

export type ProcessingInput =
  | { ok: true; disposition: InboundDisposition; folder: string; retentionDays: number }
  | { ok: false; error: string };

/** Validate the admin's processed-messages form (Settings › Inbound mail). */
export function processingInput(raw: {
  disposition: string;
  folder: string;
  retentionDays: string;
  /** The polled folder (IMAP_FOLDER); processed mail must not be moved back into it. */
  pollFolder: string;
}): ProcessingInput {
  const disposition = raw.disposition.trim().toLowerCase();
  if (!(INBOUND_DISPOSITIONS as readonly string[]).includes(disposition)) {
    return { ok: false, error: "Pick what happens to processed messages." };
  }
  const folder = raw.folder.trim();
  // Blank keeps the default folder name; a typed one must be usable.
  if (folder && !isValidFolderName(folder)) return { ok: false, error: "Enter a valid folder name for processed messages." };
  if (disposition === "move" && sameFolder(folder || DEFAULT_PROCESSED_FOLDER, raw.pollFolder || "INBOX")) {
    return { ok: false, error: "Processed messages must go to a different folder than the one that is polled." };
  }
  const retentionDays = parseRetentionDays(raw.retentionDays);
  if (retentionDays === null) {
    return { ok: false, error: `Enter a whole number of days between 0 and ${MAX_RETENTION_DAYS} (0 keeps processed messages).` };
  }
  return { ok: true, disposition: disposition as InboundDisposition, folder, retentionDays };
}
