// Pure rules of the inbound sender policy (Settings › Inbound mail). No DB, no
// IMAP: process.ts gathers the facts, these functions decide. Kept apart so the
// decision table is unit-tested on its own (tests/unit/inbound-policy.test.ts).

import { domainToASCII } from "node:url";

/**
 * Who may open a NEW ticket by email. Replies to an existing ticket are never
 * governed by the policy — a reply only lands where a conversation already exists.
 *   open    — anyone (the historical behaviour)
 *   known   — only senders with an active account (primary or secondary address)
 *   domains — active accounts plus senders from an allowed domain
 */
export const INBOUND_SENDER_POLICIES = ["open", "known", "domains"] as const;
export type InboundSenderPolicy = (typeof INBOUND_SENDER_POLICIES)[number];

export const INBOUND_SENDER_POLICY_SETTING = "INBOUND_SENDER_POLICY";
export const INBOUND_ALLOWED_DOMAINS_SETTING = "INBOUND_ALLOWED_DOMAINS";
export const INBOUND_DENY_LIST_SETTING = "INBOUND_DENY_LIST";
export const INBOUND_REJECT_AUTOREPLY_SETTING = "INBOUND_REJECT_AUTOREPLY";
/** Answer a rejection only when the sender's domain is authenticated (SPF/DKIM/DMARC); default on. */
export const INBOUND_REJECT_REQUIRE_AUTH_SETTING = "INBOUND_REJECT_REQUIRE_AUTH";

/** Why a message did not open a ticket; stored on the inbound log row (EmailMessage.error). */
export const INBOUND_REJECT_REASONS = ["denied", "sender_unknown", "domain_not_allowed"] as const;
export type InboundRejectReason = (typeof INBOUND_REJECT_REASONS)[number];

export function parseSenderPolicy(raw: string | null | undefined): InboundSenderPolicy {
  const v = (raw ?? "").trim().toLowerCase();
  return (INBOUND_SENDER_POLICIES as readonly string[]).includes(v) ? (v as InboundSenderPolicy) : "open";
}

/** Split an admin-entered list (commas, semicolons, whitespace or new lines) into lower-cased, unique entries. */
export function parseList(raw: string | null | undefined): string[] {
  return [...new Set((raw ?? "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

// The last label is letters only, or a punycode label (internationalised TLD such as xn--p1ai).
const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const LOCAL_PART = /^[^\s@,<>"]{1,64}$/;

export function isDomainEntry(entry: string): boolean {
  return DOMAIN.test(asciiDomain(entry));
}

/**
 * The comparison form of a domain: lower case, no leading `@` or trailing dot and
 * IDNs in punycode. A sender's `münchen.example` and an admin's `xn--mnchen-3ya.example`
 * (or the other way round) must be the same domain; an entry that cannot be converted is kept as typed.
 */
export function asciiDomain(domain: string): string {
  const d = domain.trim().replace(/^@/, "").replace(/\.$/, "").toLowerCase();
  return domainToASCII(d) || d;
}

/** A deny-list entry is a full address (`name@example.com`) or a domain (`example.com` or `@example.com`). */
export function isDenyEntry(entry: string): boolean {
  const at = entry.lastIndexOf("@");
  if (at <= 0) return isDomainEntry(entry);
  return LOCAL_PART.test(entry.slice(0, at)) && isDomainEntry(entry.slice(at + 1));
}

/** The domain of an address in comparison form (see asciiDomain). */
export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? asciiDomain(email.slice(at + 1)) : "";
}

/** `local@domain` with the domain in comparison form. */
function normalizeAddress(email: string): string {
  const at = email.lastIndexOf("@");
  return at > 0 ? `${email.slice(0, at).toLowerCase()}@${asciiDomain(email.slice(at + 1))}` : email.toLowerCase();
}

/** True when `domain` is `entry` or one of its subdomains (`mail.example.com` matches `example.com`). */
export function domainMatches(domain: string, entry: string): boolean {
  const base = asciiDomain(entry);
  const d = asciiDomain(domain);
  return base !== "" && (d === base || d.endsWith(`.${base}`));
}

export function isDenied(from: string, denyList: string[]): boolean {
  const sender = normalizeAddress(from);
  const domain = domainOf(sender);
  return denyList.some((entry) => (entry.lastIndexOf("@") > 0 ? normalizeAddress(entry) === sender : domainMatches(domain, entry)));
}

export function isDomainAllowed(from: string, allowedDomains: string[]): boolean {
  const domain = domainOf(from);
  return allowedDomains.some((entry) => domainMatches(domain, entry));
}

export type SenderDecisionInput = {
  from: string;
  policy: InboundSenderPolicy;
  allowedDomains: string[];
  denyList: string[];
  /** The mail matched an existing ticket (threading headers, subject tag or plus address). */
  isReply: boolean;
  /** The sender's address belongs to an active account. */
  knownActive: boolean;
};

export type SenderDecision =
  | { accept: true }
  | {
      accept: false;
      reason: InboundRejectReason;
      /** Deny-listed mail is archived silently; only policy rejections may be answered. */
      mayAutoAnswer: boolean;
    };

/**
 * May this message open a ticket (or land on one)? Replies to an existing ticket
 * are always accepted — a vendor on a deny-listed domain answering a forwarded
 * ticket must still reach it. The deny-list wins over the policy for new mail.
 */
export function decideSender(input: SenderDecisionInput): SenderDecision {
  if (input.isReply) return { accept: true };
  if (isDenied(input.from, input.denyList)) return { accept: false, reason: "denied", mayAutoAnswer: false };
  if (input.policy === "open" || input.knownActive) return { accept: true };
  if (input.policy === "domains" && isDomainAllowed(input.from, input.allowedDomains)) return { accept: true };
  return {
    accept: false,
    reason: input.policy === "known" ? "sender_unknown" : "domain_not_allowed",
    mayAutoAnswer: true,
  };
}

const NO_REPLY_LOCAL = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?)([+._-].*)?$/;

/**
 * Loop safety for the rejection auto-answer: never answer machine mail. Covers
 * RFC 3834 `Auto-Submitted`, the Microsoft/legacy auto-reply markers, bulk and
 * list mail (`Precedence`, `List-Id`, `List-Unsubscribe`), bounces (empty
 * `Return-Path`) and the usual no-reply/daemon sender names.
 */
export function isMachineMail(headers: Record<string, string>, from: string): boolean {
  const h = (k: string) => (headers[k] ?? "").trim().toLowerCase();
  const autoSubmitted = h("auto-submitted");
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (h("x-autoreply") || h("x-autorespond") || h("x-auto-response-suppress")) return true;
  if (["bulk", "list", "junk", "auto_reply"].includes(h("precedence"))) return true;
  if (h("list-id") || h("list-unsubscribe")) return true;
  if (h("return-path") === "<>") return true;
  if (h("x-loop")) return true;
  const local = from.toLowerCase().split("@")[0] ?? "";
  return NO_REPLY_LOCAL.test(local);
}

/** At most one rejection answer per address within this window (a second guard against loops). */
export const AUTO_ANSWER_COOLDOWN_HOURS = 24;

/**
 * Hard ceiling on rejection answers per hour across ALL senders. The From header
 * of the mail being answered can be forged, so every answer is potentially
 * backscatter to a stranger; a flood of forged mail must not turn the helpdesk
 * into a mail cannon.
 */
export const AUTO_ANSWER_MAX_PER_HOUR = 20;

/**
 * Did the receiving mail server authenticate the sender's domain? Reads the
 * `Authentication-Results` header(s) its MTA added (RFC 8601) and accepts a
 * `dmarc=pass`, or a `dkim=pass` / `spf=pass` whose signing / envelope domain
 * is aligned with the From domain (the same domain or a sub-/parent domain).
 * Trust note: the header is only as trustworthy as the MTA in front of the
 * mailbox — it must strip a forged one. With no such header the answer is "no".
 */
export function isSenderAuthenticated(headers: Record<string, string>, from: string): boolean {
  const results = headers["authentication-results"];
  if (!results) return false;
  const fromDomain = domainOf(from);
  if (!fromDomain) return false;
  const aligned = (d: string | undefined) => {
    if (!d) return false;
    const dom = asciiDomain(d.includes("@") ? d.slice(d.lastIndexOf("@") + 1) : d);
    return dom !== "" && (dom === fromDomain || fromDomain.endsWith(`.${dom}`) || dom.endsWith(`.${fromDomain}`));
  };
  // One header per line; a result is `method=pass` followed by its `ptype.property=value` pairs up to the next `;`.
  for (const line of results.split("\n")) {
    for (const part of line.split(";").slice(1)) {
      const m = /^\s*(dmarc|dkim|spf)\s*=\s*pass\b(.*)$/i.exec(part);
      if (!m) continue;
      const method = m[1].toLowerCase();
      if (method === "dmarc") return true;
      const prop = method === "dkim" ? /header\.(?:d|i)\s*=\s*"?([^\s";]+)/i : /smtp\.mailfrom\s*=\s*"?([^\s";]+)/i;
      if (aligned(prop.exec(m[2])?.[1])) return true;
    }
  }
  return false;
}

export type SenderPolicyInput =
  | { ok: true; policy: InboundSenderPolicy; allowedDomains: string[]; denyList: string[] }
  | { ok: false; error: string };

/** Validate the admin's sender-policy form (Settings › Inbound mail). */
export function senderPolicyInput(raw: { policy: string; allowedDomains: string; denyList: string }): SenderPolicyInput {
  const policy = raw.policy.trim().toLowerCase();
  if (!(INBOUND_SENDER_POLICIES as readonly string[]).includes(policy)) return { ok: false, error: "Pick a sender policy." };
  const allowedDomains = parseList(raw.allowedDomains).map((d) => d.replace(/^@/, ""));
  const badDomains = allowedDomains.filter((d) => !isDomainEntry(d));
  if (badDomains.length) return { ok: false, error: `Not a valid domain: ${badDomains.join(", ")}.` };
  const denyList = parseList(raw.denyList);
  const badEntries = denyList.filter((e) => !isDenyEntry(e));
  if (badEntries.length) return { ok: false, error: `Not a valid address or domain: ${badEntries.join(", ")}.` };
  return { ok: true, policy: policy as InboundSenderPolicy, allowedDomains, denyList };
}
