// "Danke, läuft wieder!" on a resolved ticket is a courtesy, not a new problem —
// reopening it wipes the resolution and puts finished work back in the queue.
// The check is deliberately conservative: anything that could be a complaint, a
// question or a longer message counts as a real reply and reopens as before.

const MAX_THANKS_CHARS = 160;
const THANKS = /\b(danke|dankeschön|vielen dank|besten dank|merci|thanks|thank you|thx|cheers)\b/i;
/** Words that turn a thank-you into a complaint ("Danke, aber geht immer noch nicht"). */
const STILL_BROKEN = /\b(nicht|nichts|kein|keine|aber|leider|immer noch|noch immer|weiterhin|erneut|wieder kaputt|problem|fehler|not|no longer|doesn'?t|don'?t|isn'?t|won'?t|still|again|but|error|issue|broken)\b/i;

/** True when a requester reply only says thanks, so a resolved ticket can stay resolved. */
export function isThankYouOnly(text: string | null | undefined): boolean {
  const reply = (text ?? "").trim();
  if (!reply || reply.length > MAX_THANKS_CHARS || reply.includes("?")) return false;
  return THANKS.test(reply) && !STILL_BROKEN.test(reply);
}
