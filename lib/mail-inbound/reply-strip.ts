// Strip the quoted conversation history from an inbound email REPLY so a ticket
// comment carries only what the sender actually wrote. The untouched original is
// still persisted on the EmailMessage row (the mail log), so nothing is lost.
//
// The rules are deliberately conservative — cutting real customer content is far
// worse than leaving a quote in place. Only used for replies matched to an
// existing ticket; a forwarded mail is never stripped (its "quote" is the point).

/** Outlook's unambiguous separator line. */
const OUTLOOK_SEPARATOR = /^\s*-{2,}\s*(Original Message|Ursprüngliche Nachricht)\s*-{2,}\s*$/i;
/** Outlook's header block: From/Von, then Sent/Gesendet, then To/An or Subject/Betreff. */
const HEADER_FROM = /^\s*(From|Von):\s.+$/i;
const HEADER_SENT = /^\s*(Sent|Gesendet):\s.+$/i;
const HEADER_TO_OR_SUBJECT = /^\s*(To|An|Cc|Subject|Betreff):\s.*$/i;
/**
 * Gmail/Apple attribution, which always carries a date:
 *   "On Tue, 5 Nov 2026 at 09:40, Servio <…> wrote:"
 *   "Am 05.11.2026 um 09:40 schrieb Servio <…>:"
 * Case-sensitive on purpose, so a German sentence like "am Montag schrieb mir…" never matches.
 */
const ATTRIBUTION = /^\s*(On\s.*\d.*\swrote:|Am\s.*\d.*\sschrieb\s.+:)\s*$/;
const QUOTED = /^\s*>/;
const FORWARDED_SUBJECT = /^\s*(fwd?|fw|wg|weitergeleitet)\s*:/i;

export function isForwardedSubject(subject: string | null | undefined): boolean {
  return FORWARDED_SUBJECT.test(subject ?? "");
}

const onlyQuotedFrom = (lines: string[], i: number) => lines.slice(i).every((l) => QUOTED.test(l) || !l.trim());

const isOutlookHeader = (lines: string[], i: number) =>
  HEADER_FROM.test(lines[i]) &&
  HEADER_SENT.test(lines[i + 1] ?? "") &&
  lines.slice(i + 2, i + 5).some((l) => HEADER_TO_OR_SUBJECT.test(l));

function quotedHistoryStartsAt(lines: string[], i: number): boolean {
  if (OUTLOOK_SEPARATOR.test(lines[i]) || isOutlookHeader(lines, i)) return true;
  // An attribution or a quote line only ends the reply when nothing but quoted
  // lines follows — interleaved ("inline") answers must survive.
  if (ATTRIBUTION.test(lines[i])) return onlyQuotedFrom(lines, i + 1);
  return QUOTED.test(lines[i]) && onlyQuotedFrom(lines, i);
}

/** The reply text above the quoted history, trimmed. Falls back to the input when nothing would remain. */
export function stripQuotedText(text: string): string {
  const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((_, i) => quotedHistoryStartsAt(lines, i));
  if (cut <= 0) return text.trim();
  return lines.slice(0, cut).join("\n").trim() || text.trim();
}

/**
 * HTML counterpart for the RAW (pre-sanitize) mail body: drop the containers mail
 * clients wrap quoted history in — Gmail `gmail_quote`, Apple/Thunderbird
 * `<blockquote type="cite">` (nested for older messages), Outlook `divRplyFwdMsg`
 * — each from its start to the end of the body. Interleaved answers live inside
 * those containers, so only call this when the text twin shows the quote is
 * trailing history. The sanitizer strips the markers, so this must run before
 * sanitizing, and the result must still be sanitized by the caller.
 */
export function stripQuotedHtml(html: string): string {
  const outlookAt = html.search(/<div[^>]*id=["']?divRplyFwdMsg/i);
  const out = (outlookAt >= 0 ? html.slice(0, outlookAt) : html)
    .replace(/<div[^>]*class=["'][^"']*gmail_quote[^"']*["'][\s\S]*$/i, "")
    .replace(/<blockquote[^>]*type=["']?cite["']?[\s\S]*$/i, "")
    .trim();
  return out || html;
}
