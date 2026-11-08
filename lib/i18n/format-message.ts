/**
 * A tiny ICU-style message formatter (no dependency). Supported syntax:
 *
 *   "Hello {name}"                                    plain placeholder
 *   "{count, plural, =0 {No tickets} one {# ticket} other {# tickets}}"
 *   "{kind, select, change {Change} other {Ticket}}"
 *   "Read <link>the guide</link>"                     tags — only for `t.rich`
 *
 * `#` inside a plural branch is the locale-formatted number. A missing variable renders
 * as an empty string, never as "{name}". Pure and isomorphic.
 */

export type MessageValue = string | number | Date | null | undefined;
export type MessageVars = Record<string, MessageValue>;

const pluralRulesCache = new Map<string, Intl.PluralRules>();
const numberFormatCache = new Map<string, Intl.NumberFormat>();

function pluralRules(locale: string) {
  let r = pluralRulesCache.get(locale);
  if (!r) {
    r = new Intl.PluralRules(locale);
    pluralRulesCache.set(locale, r);
  }
  return r;
}

function formatNumber(n: number, locale: string) {
  let f = numberFormatCache.get(locale);
  if (!f) {
    f = new Intl.NumberFormat(locale);
    numberFormatCache.set(locale, f);
  }
  return f.format(n);
}

function stringify(value: MessageValue, locale: string): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return formatNumber(value, locale);
  if (value instanceof Date) return value.toLocaleDateString(locale);
  return value;
}

/** Index of the `}` matching the `{` at `open`, or -1. */
function matchBrace(msg: string, open: number): number {
  let depth = 0;
  for (let i = open; i < msg.length; i++) {
    const c = msg[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parse `=0 {..} one {..} other {..}` into a selector → text map. */
function parseBranches(body: string): Map<string, string> {
  const branches = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++;
    const start = i;
    while (i < body.length && body[i] !== "{" && !/\s/.test(body[i])) i++;
    const selector = body.slice(start, i);
    while (i < body.length && /\s/.test(body[i])) i++;
    if (body[i] !== "{") break;
    const end = matchBrace(body, i);
    if (end < 0) break;
    if (selector) branches.set(selector, body.slice(i + 1, end));
    i = end + 1;
  }
  return branches;
}

function formatArgument(inner: string, vars: MessageVars, locale: string, hash: string | null): string {
  const firstComma = inner.indexOf(",");
  if (firstComma < 0) {
    const name = inner.trim();
    return stringify(vars[name], locale);
  }
  const name = inner.slice(0, firstComma).trim();
  const rest = inner.slice(firstComma + 1);
  const secondComma = rest.indexOf(",");
  const type = (secondComma < 0 ? rest : rest.slice(0, secondComma)).trim();
  const body = secondComma < 0 ? "" : rest.slice(secondComma + 1);
  const value = vars[name];

  if (type === "plural") {
    const n = typeof value === "number" ? value : Number(value ?? 0);
    const branches = parseBranches(body);
    const branch =
      branches.get(`=${n}`) ?? branches.get(pluralRules(locale).select(n)) ?? branches.get("other") ?? "";
    return formatMessage(branch, vars, locale, formatNumber(n, locale));
  }
  if (type === "select") {
    const branches = parseBranches(body);
    const branch = branches.get(String(value ?? "")) ?? branches.get("other") ?? "";
    return formatMessage(branch, vars, locale, hash);
  }
  // Unknown type (e.g. "number") — render the plain value.
  return stringify(value, locale);
}

/** Format `msg` with `vars` for `locale` (a BCP 47 tag such as "de-DE"). */
export function formatMessage(msg: string, vars: MessageVars | undefined, locale: string, hash: string | null = null): string {
  if (!vars && hash === null && !msg.includes("{")) return msg;
  const v = vars ?? {};
  let out = "";
  let i = 0;
  while (i < msg.length) {
    const c = msg[i];
    if (c === "{") {
      const end = matchBrace(msg, i);
      if (end < 0) {
        out += msg.slice(i);
        break;
      }
      out += formatArgument(msg.slice(i + 1, end), v, locale, hash);
      i = end + 1;
      continue;
    }
    if (c === "#" && hash !== null) {
      out += hash;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Placeholder and plural/select argument names used by a message ("{n, plural, …}" → "n"). */
export function messageArguments(msg: string): string[] {
  const names = new Set<string>();
  const walk = (s: string) => {
    let i = 0;
    while (i < s.length) {
      if (s[i] === "{") {
        const end = matchBrace(s, i);
        if (end < 0) return;
        const inner = s.slice(i + 1, end);
        const comma = inner.indexOf(",");
        names.add((comma < 0 ? inner : inner.slice(0, comma)).trim());
        if (comma >= 0) {
          for (const branch of parseBranches(inner.slice(inner.indexOf(",", comma + 1) + 1)).values()) walk(branch);
        }
        i = end + 1;
      } else i++;
    }
  };
  walk(msg);
  return [...names].sort();
}

/** Tag names used by a rich message ("<b>x</b>" → "b"). */
export function messageTags(msg: string): string[] {
  return [...new Set([...msg.matchAll(/<([a-zA-Z][\w-]*)>/g)].map((m) => m[1]))].sort();
}
