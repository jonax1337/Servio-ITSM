import { describe, expect, it } from "vitest";
import {
  PROCESSED_KEYWORD,
  parseDisposition,
  parseRetentionDays,
  processingInput,
  retentionPlan,
  sameFolder,
  supportsCustomKeywords,
} from "@/lib/mail-inbound/disposition";

const NOW = new Date("2026-11-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const plan = (over: Partial<Parameters<typeof retentionPlan>[0]>) =>
  retentionPlan({ disposition: "seen", folder: "INBOX", processedFolder: "Processed", days: 30, now: NOW, keywordSupported: true, ...over });

describe("parseDisposition", () => {
  it("defaults to seen (the historical behaviour)", () => {
    expect(parseDisposition(null)).toBe("seen");
    expect(parseDisposition("")).toBe("seen");
    expect(parseDisposition("archive")).toBe("seen");
  });

  it("accepts the three actions", () => {
    expect(parseDisposition("move")).toBe("move");
    expect(parseDisposition(" DELETE ")).toBe("delete");
  });
});

describe("parseRetentionDays", () => {
  it("treats blank as off", () => {
    expect(parseRetentionDays("")).toBe(0);
    expect(parseRetentionDays(null)).toBe(0);
  });

  it("accepts whole days up to 3650", () => {
    expect(parseRetentionDays("30")).toBe(30);
    expect(parseRetentionDays("3650")).toBe(3650);
  });

  it("rejects fractions, negatives and too many days", () => {
    expect(parseRetentionDays("1.5")).toBeNull();
    expect(parseRetentionDays("-1")).toBeNull();
    expect(parseRetentionDays("3651")).toBeNull();
    expect(parseRetentionDays("abc")).toBeNull();
  });
});

describe("retentionPlan (which messages the sweep deletes)", () => {
  it("does nothing when retention is off or messages are deleted on processing", () => {
    expect(plan({ days: 0 })).toBeNull();
    expect(plan({ disposition: "delete" })).toBeNull();
  });

  it("move: everything older than the cutoff in the processed folder", () => {
    expect(plan({ disposition: "move" })).toEqual({ mailbox: "Processed", before: new Date(NOW.getTime() - 30 * DAY), keyword: null });
  });

  it("seen: only messages Servio marked, in the polled folder", () => {
    expect(plan({ disposition: "seen", days: 7 })).toEqual({ mailbox: "INBOX", before: new Date(NOW.getTime() - 7 * DAY), keyword: PROCESSED_KEYWORD });
  });

  it("seen: skips servers that cannot store the keyword (it would delete mail people read)", () => {
    expect(plan({ disposition: "seen", keywordSupported: false })).toBeNull();
  });

  it("move into the polled folder itself falls back to the keyword rule", () => {
    expect(plan({ disposition: "move", processedFolder: "inbox" })).toMatchObject({ mailbox: "INBOX", keyword: PROCESSED_KEYWORD });
    expect(plan({ disposition: "move", processedFolder: "INBOX", keywordSupported: false })).toBeNull();
  });
});

describe("sameFolder / supportsCustomKeywords", () => {
  it("compares INBOX case-insensitively and other folders exactly", () => {
    expect(sameFolder("Inbox", "INBOX")).toBe(true);
    expect(sameFolder("Processed", "processed")).toBe(false);
    expect(sameFolder(" Processed ", "Processed")).toBe(true);
  });

  it("reads PERMANENTFLAGS", () => {
    expect(supportsCustomKeywords(new Set(["\\Seen", "\\*"]))).toBe(true);
    expect(supportsCustomKeywords(new Set(["\\Seen", "\\Deleted"]))).toBe(false);
    expect(supportsCustomKeywords(undefined)).toBe(true);
  });
});

describe("processingInput (settings form)", () => {
  const input = (over: Partial<Parameters<typeof processingInput>[0]>) =>
    processingInput({ disposition: "seen", folder: "", retentionDays: "", pollFolder: "INBOX", ...over });

  it("accepts the default", () => {
    expect(input({})).toEqual({ ok: true, disposition: "seen", folder: "", retentionDays: 0 });
  });

  it("accepts a move with a folder and retention", () => {
    expect(input({ disposition: "move", folder: "Servio/Done", retentionDays: "90" })).toEqual({
      ok: true,
      disposition: "move",
      folder: "Servio/Done",
      retentionDays: 90,
    });
  });

  it("refuses moving into the polled folder", () => {
    expect(input({ disposition: "move", folder: "inbox" })).toEqual({
      ok: false,
      error: "Processed messages must go to a different folder than the one that is polled.",
    });
    expect(input({ disposition: "move", folder: "", pollFolder: "Processed" }).ok).toBe(false);
  });

  it("refuses unknown actions, wildcard folders and bad day counts", () => {
    expect(input({ disposition: "archive" })).toEqual({ ok: false, error: "Pick what happens to processed messages." });
    expect(input({ disposition: "move", folder: "Done*" })).toEqual({ ok: false, error: "Enter a valid folder name for processed messages." });
    expect(input({ retentionDays: "-3" })).toEqual({
      ok: false,
      error: "Enter a whole number of days between 0 and 3650 (0 keeps processed messages).",
    });
  });
});
