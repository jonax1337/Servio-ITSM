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
const ATTRIBUTION = /^\s*(On\s[^\n]{0,200}?\d[^\n]{0,200}?\swrote:|Am\s[^\n]{0,200}?\d[^\n]{0,200}?\sschrieb\s[^\n]{1,200}:)\s*$/;
const QUOTED = /^\s*>/;
/** Attribution/header lines are short; longer lines are never treated as one (bounds regex work). */
const MAX_MARKER_LINE = 500;
/** Bodies above this size are stored as-is rather than scanned (an inbound mail is attacker-controlled). */
const MAX_STRIP_CHARS = 200_000;
const FORWARDED_SUBJECT = /^\s*(fwd?|fw|wg|weitergeleitet)\s*:/i;

export function isForwardedSubject(subject: string | null | undefined): boolean {
  return FORWARDED_SUBJECT.test(subject ?? "");
}

const isMarker = (re: RegExp, line: string | undefined) => !!line && line.length <= MAX_MARKER_LINE && re.test(line);

const isOutlookHeader = (lines: string[], i: number) =>
  isMarker(HEADER_FROM, lines[i]) &&
  isMarker(HEADER_SENT, lines[i + 1]) &&
  lines.slice(i + 2, i + 5).some((l) => isMarker(HEADER_TO_OR_SUBJECT, l));

/** quotedTail[i] — every line from i to the end is quoted or blank (one backward pass). */
function quotedTailFlags(lines: string[]): boolean[] {
  const flags = new Array<boolean>(lines.length + 1);
  flags[lines.length] = true;
  for (let i = lines.length - 1; i >= 0; i--) flags[i] = flags[i + 1] && (QUOTED.test(lines[i]) || !lines[i].trim());
  return flags;
}

function quotedHistoryStartsAt(lines: string[], i: number, quotedTail: boolean[]): boolean {
  if (isMarker(OUTLOOK_SEPARATOR, lines[i]) || isOutlookHeader(lines, i)) return true;
  // An attribution or a quote line only ends the reply when nothing but quoted
  // lines follows — interleaved ("inline") answers must survive.
  if (isMarker(ATTRIBUTION, lines[i])) return quotedTail[i + 1];
  return QUOTED.test(lines[i]) && quotedTail[i];
}

/** The reply text above the quoted history, trimmed. Falls back to the input when nothing would remain. */
export function stripQuotedText(text: string): string {
  if ((text ?? "").length > MAX_STRIP_CHARS) return text.trim();
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const quotedTail = quotedTailFlags(lines);
  const cut = lines.findIndex((_, i) => quotedHistoryStartsAt(lines, i, quotedTail));
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
  if (html.length > MAX_STRIP_CHARS) return html;
  // Bounded attribute scans keep the work linear on hostile markup.
  const cutAt = (re: RegExp, s: string) => {
    const at = s.search(re);
    return at >= 0 ? s.slice(0, at) : s;
  };
  let out = cutAt(/<div[^>]{0,500}?id=["']?divRplyFwdMsg/i, html);
  out = cutAt(/<div[^>]{0,500}?class=["'][^"'>]{0,300}?gmail_quote/i, out);
  out = cutAt(/<blockquote[^>]{0,500}?type=["']?cite/i, out);
  return out.trim() || html;
}
