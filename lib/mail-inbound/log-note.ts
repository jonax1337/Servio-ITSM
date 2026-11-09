// What the mail log shows next to an inbound message: the reason a message was
// rejected/archived, or which attachments were not stored. Both live in
// EmailMessage.error as a machine-readable note so the log can word it in the
// viewer's language. Pure; shared by the processor and the mail log page.

import { INBOUND_REJECT_REASONS, type InboundRejectReason } from "./policy";

const SKIPPED_PREFIX = "skipped_attachments:";

export function skippedAttachmentsNote(filenames: string[]): string {
  return `${SKIPPED_PREFIX}${filenames.join(", ")}`;
}

export type InboundLogNote =
  | { kind: "reason"; reason: InboundRejectReason }
  | { kind: "skippedAttachments"; filenames: string }
  | null;

export function parseInboundLogNote(error: string | null | undefined): InboundLogNote {
  if (!error) return null;
  if ((INBOUND_REJECT_REASONS as readonly string[]).includes(error)) return { kind: "reason", reason: error as InboundRejectReason };
  if (error.startsWith(SKIPPED_PREFIX)) return { kind: "skippedAttachments", filenames: error.slice(SKIPPED_PREFIX.length) };
  return null;
}
