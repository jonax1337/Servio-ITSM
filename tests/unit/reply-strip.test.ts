import { describe, expect, it } from "vitest";
import { isForwardedSubject, stripQuotedHtml, stripQuotedText } from "@/lib/mail-inbound/reply-strip";
import { sanitizeCommentHtml } from "@/lib/markdown";

const REPLY = "Danke, das hat geholfen.\n\nGruß\nHannah";

describe("stripQuotedText", () => {
  it("cuts a German Gmail/Apple attribution and everything after it", () => {
    const text = `${REPLY}\n\nAm 05.11.2026 um 09:40 schrieb Servio Service Desk <support@servio.dev>:\n> Hallo Frau Berger,\n> wir schauen es uns an.`;
    expect(stripQuotedText(text)).toBe(REPLY);
  });

  it("cuts an English attribution", () => {
    const text = `${REPLY}\n\nOn Tue, 5 Nov 2026 at 09:40, Servio <support@servio.dev> wrote:\n> Hello`;
    expect(stripQuotedText(text)).toBe(REPLY);
  });

  it("cuts an Outlook original-message separator and From/Sent/Subject header block", () => {
    expect(stripQuotedText(`${REPLY}\n\n-----Ursprüngliche Nachricht-----\nVon: Servio\nText`)).toBe(REPLY);
    expect(stripQuotedText(`${REPLY}\n\nFrom: Servio <support@servio.dev>\nSent: Tuesday\nSubject: x`)).toBe(REPLY);
    expect(stripQuotedText(`${REPLY}\n\nVon: Servio <support@servio.dev>\nGesendet: Mittwoch\nAn: Hannah\nBetreff: x`)).toBe(REPLY);
  });

  it("cuts a trailing block of > quoted lines", () => {
    expect(stripQuotedText(`${REPLY}\n\n> old line one\n>\n> old line two`)).toBe(REPLY);
  });

  it("keeps inline quotes that are followed by the sender's own answer", () => {
    const text = "> Ist der Drucker an?\nJa, ist er.\n> Leuchtet die LED?\nNein.";
    expect(stripQuotedText(text)).toBe(text);
  });

  it("keeps a 'From:' line that is not an Outlook header block", () => {
    const text = "From: the warehouse we still get blank pages.\nThanks";
    expect(stripQuotedText(text)).toBe(text);
  });

  it("keeps inline answers written below an attribution line", () => {
    const text = "Answers inline.\n\nOn Tue, 5 Nov 2026 at 09:40, Servio wrote:\n> Which OS?\nWindows 11\n> Since when?\nYesterday";
    expect(stripQuotedText(text)).toBe(text);
  });

  it("does not mistake an ordinary German sentence for an attribution", () => {
    const text = "Hallo,\nam Montag schrieb mir das System folgende Meldung:\nFehler 0x80070005";
    expect(stripQuotedText(text)).toBe(text);
  });

  it("needs a full Outlook header block, not a lone From/Sent pair", () => {
    const text = "Please see the vendor reply below.\n\nFrom: Vendor <v@x.com>\nSent: Monday\nWe shipped the fix in 4.2.";
    expect(stripQuotedText(text)).toBe(text);
  });

  it("returns the original when the mail is only a quote", () => {
    const text = "Am 05.11.2026 schrieb Servio:\n> Hallo";
    expect(stripQuotedText(text)).toBe(text);
  });
});

describe("stripQuotedHtml", () => {
  it("removes a Gmail quote container", () => {
    expect(stripQuotedHtml('<p>Danke!</p><div class="gmail_quote"><p>Am … schrieb:</p><blockquote>old</blockquote></div>')).toBe("<p>Danke!</p>");
  });

  it("removes cite blockquotes (including nested older quotes) and Outlook reply headers", () => {
    expect(stripQuotedHtml('<p>Danke!</p><blockquote type="cite"><p>old</p></blockquote>')).toBe("<p>Danke!</p>");
    expect(stripQuotedHtml('<p>Danke!</p><blockquote type="cite"><p>old</p><blockquote type="cite"><p>older</p></blockquote><p>tail</p></blockquote>')).toBe("<p>Danke!</p>");
    expect(stripQuotedHtml('<p>Danke!</p><div id="divRplyFwdMsg"><b>From:</b> x</div><p>old</p>')).toBe("<p>Danke!</p>");
  });

  it("keeps the html when stripping would leave nothing", () => {
    const html = '<div class="gmail_quote">only quote</div>';
    expect(stripQuotedHtml(html)).toBe(html);
  });

  it("works on raw client markup so the sanitized comment no longer holds the history", () => {
    const gmail = '<div dir="ltr">Thanks, fixed!</div><br><div class="gmail_quote"><div class="gmail_attr">On Tue wrote:</div><blockquote class="gmail_quote">old stuff</blockquote></div>';
    const clean = sanitizeCommentHtml(stripQuotedHtml(gmail));
    expect(clean).toContain("Thanks, fixed!");
    expect(clean).not.toContain("old stuff");
  });
});

describe("isForwardedSubject", () => {
  it("recognises forward prefixes in English and German", () => {
    for (const s of ["Fwd: x", "FW: x", "WG: x", "Weitergeleitet: x"]) expect(isForwardedSubject(s), s).toBe(true);
    for (const s of ["Re: x", "AW: x", "Forward planning"]) expect(isForwardedSubject(s), s).toBe(false);
  });
});
