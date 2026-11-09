import { describe, expect, it, vi } from "vitest";
import type { ImapFlow } from "imapflow";
import { dispose, parseRaw, sweepRetention } from "@/lib/mail-inbound/imap";
import { PROCESSED_KEYWORD } from "@/lib/mail-inbound/disposition";
import { isMachineMail, isSenderAuthenticated } from "@/lib/mail-inbound/policy";
import type { InboundConfig } from "@/lib/mail-inbound/types";

// ── parseRaw → isMachineMail with REAL raw messages ──────────────────────────
// mailparser folds every List-* header into one `list` object and parses
// Return-Path as an address; the loop-safety checks must still see them.

const raw = (lines: string[]) => `${lines.join("\r\n")}\r\n\r\nbody\r\n`;
const msg = (extra: string[]) =>
  raw(["From: Jane <jane@customer.example>", "To: help@example.org", "Subject: hello", "Message-ID: <1@customer.example>", ...extra]);

async function machine(extra: string[]) {
  const mail = await parseRaw(msg(extra));
  return isMachineMail(mail.headers, mail.fromEmail);
}

describe("parseRaw keeps the headers the loop guard reads", () => {
  it("a plain message is not machine mail", async () => {
    expect(await machine([])).toBe(false);
  });

  it("recognises list mail by List-Id", async () => {
    expect(await machine(["List-Id: <news.customer.example>"])).toBe(true);
  });

  it("recognises list mail by List-Unsubscribe alone", async () => {
    expect(await machine(["List-Unsubscribe: <mailto:unsub@customer.example>, <https://customer.example/u/1>"])).toBe(true);
  });

  it("recognises a bounce by its empty Return-Path", async () => {
    expect(await machine(["Return-Path: <>"])).toBe(true);
  });

  it("an ordinary Return-Path does not count", async () => {
    expect(await machine(["Return-Path: <jane@customer.example>"])).toBe(false);
  });

  it("recognises Auto-Submitted and bulk precedence", async () => {
    expect(await machine(["Auto-Submitted: auto-generated"])).toBe(true);
    expect(await machine(["Precedence: bulk"])).toBe(true);
  });

  it("reads a folded List-Unsubscribe header", async () => {
    const mail = await parseRaw(msg(["List-Unsubscribe: <mailto:unsub@customer.example>,", " <https://customer.example/u/1>"]));
    expect(mail.headers["list-unsubscribe"]).toBe("<mailto:unsub@customer.example>, <https://customer.example/u/1>");
    expect(mail.headers["list"]).toBeUndefined();
  });

  it("exposes every Authentication-Results line to the sender check", async () => {
    const mail = await parseRaw(
      msg([
        "Authentication-Results: mx1.example.org; spf=fail smtp.mailfrom=x@evil.example",
        "Authentication-Results: mx2.example.org; dkim=pass header.d=customer.example",
      ]),
    );
    expect(isSenderAuthenticated(mail.headers, mail.fromEmail)).toBe(true);
    const failed = await parseRaw(msg(["Authentication-Results: mx.example.org; dkim=fail header.d=customer.example"]));
    expect(isSenderAuthenticated(failed.headers, failed.fromEmail)).toBe(false);
  });
});

// ── dispose / retention against a scripted IMAP client ──────────────────────

type Call = [string, ...unknown[]];

function fakeClient(opts: { caps: string[]; permanentFlags?: string[]; copy?: boolean; found?: number[] }) {
  const calls: Call[] = [];
  const opened: string[] = [];
  const client = {
    capabilities: new Map(opts.caps.map((c) => [c, true])),
    mailbox: { permanentFlags: new Set(opts.permanentFlags ?? ["\\*"]) },
    messageFlagsAdd: vi.fn(async (...a: unknown[]) => (calls.push(["flags", ...a]), true)),
    messageMove: vi.fn(async (...a: unknown[]) => (calls.push(["move", ...a]), { path: "INBOX" })),
    messageCopy: vi.fn(async (...a: unknown[]) => (calls.push(["copy", ...a]), opts.copy === false ? false : { path: "INBOX" })),
    messageDelete: vi.fn(async (...a: unknown[]) => (calls.push(["delete", ...a]), true)),
    search: vi.fn(async (...a: unknown[]) => (calls.push(["search", ...a]), opts.found ?? [])),
    getMailboxLock: vi.fn(async (m: string) => (opened.push(m), { release: () => undefined })),
  };
  return { client: client as unknown as ImapFlow, calls, opened };
}

const config = (over: Partial<InboundConfig>): InboundConfig => ({
  host: "imap.example",
  port: 993,
  secure: true,
  user: "u",
  pass: "p",
  folder: "INBOX",
  disposition: "seen",
  processedFolder: "Processed",
  retentionDays: 30,
  ...over,
});
const kinds = (calls: Call[]) => calls.map((c) => c[0]);

describe("dispose — move", () => {
  it("uses MOVE when the server has it", async () => {
    const f = fakeClient({ caps: ["MOVE", "UIDPLUS"] });
    await dispose(f.client, 7, config({ disposition: "move" }), true);
    expect(kinds(f.calls)).toEqual(["flags", "move"]);
    expect(f.calls[1]).toEqual(["move", "7", "Processed", { uid: true }]);
  });

  it("copies and then deletes on a server without MOVE", async () => {
    const f = fakeClient({ caps: ["UIDPLUS"] });
    await dispose(f.client, 7, config({ disposition: "move" }), true);
    expect(kinds(f.calls)).toEqual(["flags", "copy", "delete"]);
  });

  it("never deletes the original when the copy failed - it stays, marked read", async () => {
    const f = fakeClient({ caps: ["UIDPLUS"], copy: false });
    await dispose(f.client, 7, config({ disposition: "move" }), true);
    expect(kinds(f.calls)).not.toContain("delete");
    expect(kinds(f.calls)).toEqual(["flags", "copy", "flags"]);
  });

  it("does not expunge without UIDPLUS (it would remove other people's deleted mail)", async () => {
    const f = fakeClient({ caps: [] });
    await dispose(f.client, 7, config({ disposition: "move" }), true);
    expect(kinds(f.calls)).not.toContain("delete");
  });
});

describe("dispose — delete and seen", () => {
  it("deletes by UID with UIDPLUS", async () => {
    const f = fakeClient({ caps: ["UIDPLUS"] });
    await dispose(f.client, 7, config({ disposition: "delete" }), true);
    expect(f.calls).toEqual([["delete", "7", { uid: true }]]);
  });

  it("falls back to marking read without UIDPLUS", async () => {
    const f = fakeClient({ caps: [] });
    await dispose(f.client, 7, config({ disposition: "delete" }), true);
    expect(kinds(f.calls)).toEqual(["flags"]);
    expect(f.calls[0][2]).toEqual(["\\Seen", PROCESSED_KEYWORD]);
  });

  it("seen: flags read, without the keyword when the server cannot store one", async () => {
    const f = fakeClient({ caps: [] });
    await dispose(f.client, 7, config({ disposition: "seen" }), false);
    expect(f.calls).toEqual([["flags", "7", ["\\Seen"], { uid: true }]]);
  });
});

describe("sweepRetention", () => {
  const NOW = new Date("2026-11-20T12:00:00Z");

  it("move mode sweeps the processed folder - every old message, no keyword", async () => {
    const f = fakeClient({ caps: ["UIDPLUS"], found: [3, 4] });
    const n = await sweepRetention(f.client, config({ disposition: "move", folder: "INBOX" }), NOW);
    expect(n).toBe(2);
    expect(f.opened).toEqual(["Processed"]);
    const search = f.calls.find((c) => c[0] === "search")!;
    expect(search[1]).toEqual({ before: new Date(NOW.getTime() - 30 * 86_400_000) });
    expect(f.calls.find((c) => c[0] === "delete")).toEqual(["delete", [3, 4], { uid: true }]);
  });

  it("move mode with an empty polled-folder setting still resolves to INBOX", async () => {
    const f = fakeClient({ caps: ["UIDPLUS"], found: [1] });
    await sweepRetention(f.client, config({ disposition: "move", folder: "" }), NOW);
    expect(f.opened).toEqual(["Processed"]);
  });

  it("seen mode sweeps the polled folder, only messages carrying the keyword", async () => {
    const f = fakeClient({ caps: ["UIDPLUS"], found: [9] });
    await sweepRetention(f.client, config({ disposition: "seen", folder: "Support" }), NOW);
    expect(f.opened).toEqual(["Support"]);
    expect((f.calls.find((c) => c[0] === "search")![1] as { keyword?: string }).keyword).toBe(PROCESSED_KEYWORD);
  });

  it("seen mode skips a mailbox that cannot store the keyword", async () => {
    const f = fakeClient({ caps: ["UIDPLUS"], permanentFlags: ["\\Seen", "\\Deleted"], found: [9] });
    expect(await sweepRetention(f.client, config({ disposition: "seen" }), NOW)).toBe(0);
    expect(kinds(f.calls)).not.toContain("delete");
  });

  it("does nothing without UIDPLUS - a plain EXPUNGE would take other people's mail", async () => {
    const f = fakeClient({ caps: [], found: [9] });
    expect(await sweepRetention(f.client, config({ disposition: "move" }), NOW)).toBe(0);
    expect(f.opened).toEqual([]);
  });

  it("does nothing when retention is off or messages are deleted on arrival", async () => {
    const off = fakeClient({ caps: ["UIDPLUS"] });
    expect(await sweepRetention(off.client, config({ retentionDays: 0 }), NOW)).toBe(0);
    const del = fakeClient({ caps: ["UIDPLUS"] });
    expect(await sweepRetention(del.client, config({ disposition: "delete" }), NOW)).toBe(0);
    expect(off.opened).toEqual([]);
    expect(del.opened).toEqual([]);
  });
});
