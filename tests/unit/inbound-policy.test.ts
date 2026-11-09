import { describe, expect, it } from "vitest";
import {
  decideSender,
  domainMatches,
  isDenied,
  isDenyEntry,
  isMachineMail,
  isSenderAuthenticated,
  parseList,
  parseSenderPolicy,
  senderPolicyInput,
  type SenderDecisionInput,
} from "@/lib/mail-inbound/policy";

const base: SenderDecisionInput = {
  from: "jane@customer.example",
  policy: "open",
  allowedDomains: [],
  denyList: [],
  isReply: false,
  knownActive: false,
};
const decide = (over: Partial<SenderDecisionInput>) => decideSender({ ...base, ...over });

describe("decideSender — open policy", () => {
  it("accepts an unknown sender", () => {
    expect(decide({ policy: "open" })).toEqual({ accept: true });
  });

  it("archives a deny-listed sender without an answer", () => {
    expect(decide({ policy: "open", denyList: ["customer.example"] })).toEqual({ accept: false, reason: "denied", mayAutoAnswer: false });
  });
});

describe("decideSender — known policy", () => {
  it("accepts an active account", () => {
    expect(decide({ policy: "known", knownActive: true })).toEqual({ accept: true });
  });

  it("rejects an unknown or inactive sender and allows an answer", () => {
    expect(decide({ policy: "known" })).toEqual({ accept: false, reason: "sender_unknown", mayAutoAnswer: true });
  });

  it("does not let an allowed domain in", () => {
    expect(decide({ policy: "known", allowedDomains: ["customer.example"] }).accept).toBe(false);
  });

  it("lets the deny-list win over an active account", () => {
    expect(decide({ policy: "known", knownActive: true, denyList: ["jane@customer.example"] })).toMatchObject({ reason: "denied" });
  });
});

describe("decideSender — domains policy", () => {
  it("accepts a sender from an allowed domain or one of its subdomains", () => {
    expect(decide({ policy: "domains", allowedDomains: ["customer.example"] })).toEqual({ accept: true });
    expect(decide({ policy: "domains", from: "a@mail.customer.example", allowedDomains: ["customer.example"] })).toEqual({ accept: true });
  });

  it("accepts an active account from any domain", () => {
    expect(decide({ policy: "domains", knownActive: true, allowedDomains: ["other.example"] })).toEqual({ accept: true });
  });

  it("rejects other domains", () => {
    expect(decide({ policy: "domains", allowedDomains: ["other.example"] })).toEqual({
      accept: false,
      reason: "domain_not_allowed",
      mayAutoAnswer: true,
    });
  });

  it("with an empty allow-list behaves like known", () => {
    expect(decide({ policy: "domains" }).accept).toBe(false);
    expect(decide({ policy: "domains", knownActive: true }).accept).toBe(true);
  });
});

describe("decideSender — replies", () => {
  it("always accepts a reply to an existing ticket, even from a denied sender", () => {
    for (const policy of ["open", "known", "domains"] as const) {
      expect(decide({ policy, isReply: true, denyList: ["customer.example"] })).toEqual({ accept: true });
    }
  });
});

describe("deny-list matching", () => {
  it("matches a full address exactly", () => {
    expect(isDenied("news@vendor.example", ["news@vendor.example"])).toBe(true);
    expect(isDenied("other@vendor.example", ["news@vendor.example"])).toBe(false);
  });

  it("matches a domain with or without @ and its subdomains", () => {
    expect(isDenied("x@vendor.example", ["vendor.example"])).toBe(true);
    expect(isDenied("x@vendor.example", ["@vendor.example"])).toBe(true);
    expect(isDenied("x@eu.vendor.example", ["vendor.example"])).toBe(true);
  });

  it("does not match a domain that only ends with the same letters", () => {
    expect(domainMatches("evilvendor.example", "vendor.example")).toBe(false);
    expect(isDenied("x@evilvendor.example", ["vendor.example"])).toBe(false);
  });

  it("is case-insensitive on the sender", () => {
    expect(isDenied("News@Vendor.Example", ["news@vendor.example"])).toBe(true);
  });
});

describe("isMachineMail (loop safety of the auto-answer)", () => {
  it("is false for a plain human message", () => {
    expect(isMachineMail({}, "jane@customer.example")).toBe(false);
    expect(isMachineMail({ "auto-submitted": "no" }, "jane@customer.example")).toBe(false);
  });

  it.each([
    [{ "auto-submitted": "auto-replied" }],
    [{ "auto-submitted": "auto-generated" }],
    [{ precedence: "bulk" }],
    [{ precedence: "list" }],
    [{ precedence: "junk" }],
    [{ "list-id": "<news.vendor.example>" }],
    [{ "list-unsubscribe": "<mailto:u@vendor.example>" }],
    [{ "x-auto-response-suppress": "All" }],
    [{ "x-autoreply": "yes" }],
    [{ "return-path": "<>" }],
    [{ "x-loop": "helpdesk" }],
  ])("is true for %o", (headers) => {
    expect(isMachineMail(headers as Record<string, string>, "jane@customer.example")).toBe(true);
  });

  it.each(["noreply@x.example", "no-reply@x.example", "donotreply@x.example", "mailer-daemon@x.example", "postmaster@x.example", "bounce+123@x.example"])(
    "is true for the sender %s",
    (from) => {
      expect(isMachineMail({}, from)).toBe(true);
    },
  );
});

describe("parseList / parseSenderPolicy", () => {
  it("splits on commas, semicolons, spaces and new lines and de-duplicates", () => {
    expect(parseList(" A.example, b.example;\nA.example  c.example ")).toEqual(["a.example", "b.example", "c.example"]);
    expect(parseList(null)).toEqual([]);
  });

  it("falls back to open for unknown values", () => {
    expect(parseSenderPolicy("KNOWN")).toBe("known");
    expect(parseSenderPolicy("whatever")).toBe("open");
    expect(parseSenderPolicy(null)).toBe("open");
  });
});

describe("senderPolicyInput (settings form)", () => {
  it("normalizes valid input", () => {
    expect(senderPolicyInput({ policy: "domains", allowedDomains: "@Customer.example, partner.example", denyList: "News@Vendor.example\nads.example" })).toEqual({
      ok: true,
      policy: "domains",
      allowedDomains: ["customer.example", "partner.example"],
      denyList: ["news@vendor.example", "ads.example"],
    });
  });

  it("rejects an unknown policy", () => {
    expect(senderPolicyInput({ policy: "nobody", allowedDomains: "", denyList: "" })).toEqual({ ok: false, error: "Pick a sender policy." });
  });

  it("names invalid domains and deny entries", () => {
    expect(senderPolicyInput({ policy: "open", allowedDomains: "localhost, ok.example", denyList: "" })).toEqual({ ok: false, error: "Not a valid domain: localhost." });
    expect(senderPolicyInput({ policy: "open", allowedDomains: "", denyList: "a@@b, x@y.example" })).toEqual({
      ok: false,
      error: "Not a valid address or domain: a@@b.",
    });
  });

  it("accepts addresses and domains on the deny-list", () => {
    expect(isDenyEntry("news@vendor.example")).toBe(true);
    expect(isDenyEntry("@vendor.example")).toBe(true);
    expect(isDenyEntry("vendor.example")).toBe(true);
    expect(isDenyEntry("vendor")).toBe(false);
  });
});

describe("internationalised domains", () => {
  it("matches a Unicode sender against a punycode entry and the other way round", () => {
    expect(isDenied("jane@münchen.example", ["xn--mnchen-3ya.example"])).toBe(true);
    expect(isDenied("jane@xn--mnchen-3ya.example", ["münchen.example"])).toBe(true);
    expect(isDenied("jane@mail.münchen.example", ["münchen.example"])).toBe(true);
    expect(isDenied("jane@münchen.example", ["xn--mnchen-3ya.example"])).toBe(true);
  });

  it("matches a deny-listed address regardless of the domain's spelling", () => {
    expect(isDenied("Spam@münchen.example", ["spam@xn--mnchen-3ya.example"])).toBe(true);
    expect(isDenied("other@münchen.example", ["spam@xn--mnchen-3ya.example"])).toBe(false);
  });

  it("applies to the allowed-domains list too", () => {
    expect(decideSender({ ...base, from: "jane@münchen.example", policy: "domains", allowedDomains: ["xn--mnchen-3ya.example"] })).toEqual({ accept: true });
  });

  it("accepts Unicode and punycode domains and top-level domains in the form", () => {
    const ok = senderPolicyInput({ policy: "domains", allowedDomains: "münchen.example, example.xn--p1ai, пример.рф", denyList: "" });
    expect(ok.ok).toBe(true);
    expect(domainMatches("shop.xn--mnchen-3ya.example", "münchen.example")).toBe(true);
  });

  it("still rejects things that are not domains", () => {
    expect(senderPolicyInput({ policy: "domains", allowedDomains: "no spaces.example", denyList: "" }).ok).toBe(false);
    expect(senderPolicyInput({ policy: "domains", allowedDomains: "localhost", denyList: "" }).ok).toBe(false);
  });
});

describe("isSenderAuthenticated (backscatter guard of the auto-answer)", () => {
  const auth = (v: string) => ({ "authentication-results": v });

  it("accepts dmarc=pass", () => {
    expect(isSenderAuthenticated(auth("mx.example.org; dmarc=pass header.from=customer.example"), "jane@customer.example")).toBe(true);
  });

  it("accepts dkim=pass or spf=pass only when the domain is aligned with From", () => {
    expect(isSenderAuthenticated(auth("mx.example.org; dkim=pass header.d=customer.example"), "jane@customer.example")).toBe(true);
    expect(isSenderAuthenticated(auth("mx.example.org; spf=pass smtp.mailfrom=bounce@mail.customer.example"), "jane@customer.example")).toBe(true);
    expect(isSenderAuthenticated(auth("mx.example.org; dkim=pass header.d=mailer.example"), "jane@customer.example")).toBe(false);
    expect(isSenderAuthenticated(auth("mx.example.org; spf=pass smtp.mailfrom=x@evil.example"), "ceo@customer.example")).toBe(false);
  });

  it("refuses failures, missing information and a missing header", () => {
    expect(isSenderAuthenticated(auth("mx.example.org; dmarc=fail header.from=customer.example; spf=softfail"), "jane@customer.example")).toBe(false);
    expect(isSenderAuthenticated(auth("mx.example.org; dkim=pass"), "jane@customer.example")).toBe(false);
    expect(isSenderAuthenticated({}, "jane@customer.example")).toBe(false);
    expect(isSenderAuthenticated(auth("mx.example.org; dmarc=pass"), "no-domain")).toBe(false);
  });

  it("looks at every Authentication-Results line", () => {
    expect(isSenderAuthenticated(auth("a.example; dmarc=fail\nb.example; dmarc=pass"), "jane@customer.example")).toBe(true);
  });
});
