/** Pure rules for a person's secondary email addresses (no DB). */

import { isEmailShape, normalizeEmail } from "@/lib/person-rules";

export const MAX_SECONDARY_EMAILS = 10;

export type SecondaryEmailsResult = { ok: true; emails: string[] } | { ok: false; error: string };

/**
 * Normalize the secondary addresses submitted for a person: lower-cased, trimmed,
 * de-duplicated, blanks dropped. Rejects a malformed address, the person's own
 * primary address and more than MAX_SECONDARY_EMAILS entries. Whether another
 * person already uses an address is a DB question (lib/user-emails.ts).
 */
export function normalizeSecondaryEmails(input: readonly string[], primary: string): SecondaryEmailsResult {
  const primaryEmail = normalizeEmail(primary);
  const emails = [...new Set(input.map(normalizeEmail).filter(Boolean))];
  const malformed = emails.find((e) => !isEmailShape(e));
  if (malformed) return { ok: false, error: `"${malformed}" is not a valid email address.` };
  if (emails.includes(primaryEmail)) return { ok: false, error: "The primary address cannot also be a secondary address." };
  if (emails.length > MAX_SECONDARY_EMAILS) {
    return { ok: false, error: `A person can have at most ${MAX_SECONDARY_EMAILS} secondary addresses.` };
  }
  return { ok: true, emails };
}

/** Split a textarea/comma list of addresses into raw entries (normalization happens in normalizeSecondaryEmails). */
export function splitEmailList(raw: string): string[] {
  return raw.split(/[\s,;]+/).filter(Boolean);
}
