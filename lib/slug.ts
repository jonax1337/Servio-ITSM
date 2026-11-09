/**
 * URL slugs. Letters outside a-z are transliterated instead of dropped, so a German
 * title keeps its words ("Passwort ändern" -> "passwort-aendern", not "passwort-ndern").
 * Applies to NEW slugs only: a stored slug is never recomputed, so existing links stay stable.
 */

/** Letters that Unicode decomposition cannot reduce to ASCII (applied to lower-case text). */
const SPECIAL: Record<string, string> = {
  "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss",
  "æ": "ae", "œ": "oe", "ø": "o", "đ": "d", "ð": "d", "ł": "l", "þ": "th", "ħ": "h", "ı": "i",
};

/** Lower-case ASCII with umlauts spelled out (ä->ae, ö->oe, ü->ue, ß->ss) and other diacritics stripped. */
export function transliterate(input: string): string {
  const lower = input.toLowerCase().replace(/[äöüßæœøđðłþħı]/g, (c) => SPECIAL[c] ?? c);
  return lower.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** URL slug: transliterated, non-alphanumerics -> "-", collapsed and trimmed; `fallback` when nothing is left. */
export function slugify(input: string, fallback = "article", maxLength = 80): string {
  return (
    transliterate(input.trim())
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, maxLength)
      .replace(/-+$/g, "") || fallback
  );
}
