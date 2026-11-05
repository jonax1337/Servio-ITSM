import { describe, expect, it } from "vitest";
import {
  clip,
  fromActionResult,
  parseArticleLinkTarget,
  parseRecordNumber,
  verifyFieldWrite,
} from "@/lib/ai-operations/helpers";

describe("parseRecordNumber", () => {
  it("accepts a prefixed ref, any case, with or without zero padding", () => {
    expect(parseRecordNumber("PRB-0019", ["PRB"])).toBe(19);
    expect(parseRecordNumber("prb-19", ["PRB"])).toBe(19);
    expect(parseRecordNumber(" CHG-0025 ", ["CHG"])).toBe(25);
  });

  it("accepts a bare number", () => {
    expect(parseRecordNumber("157", ["INC", "REQ"])).toBe(157);
  });

  it("accepts any of several allowed prefixes", () => {
    expect(parseRecordNumber("INC-0157", ["INC", "REQ"])).toBe(157);
    expect(parseRecordNumber("REQ-0003", ["INC", "REQ"])).toBe(3);
  });

  it("rejects a ref of the wrong kind instead of linking the wrong record", () => {
    expect(parseRecordNumber("CHG-0025", ["PRB"])).toBeNull();
    expect(parseRecordNumber("PRB-0019", ["INC", "REQ"])).toBeNull();
  });

  it("rejects text without a number, zero and trailing junk", () => {
    expect(parseRecordNumber("none", ["PRB"])).toBeNull();
    expect(parseRecordNumber("", ["PRB"])).toBeNull();
    expect(parseRecordNumber(undefined, ["PRB"])).toBeNull();
    expect(parseRecordNumber("PRB-0", ["PRB"])).toBeNull();
    expect(parseRecordNumber("PRB-19 and more", ["PRB"])).toBeNull();
  });
});

// The link ops read the relation id back after the server action ran.
describe("link verification (verifyFieldWrite on the stored relation id)", () => {
  it("confirms a link that landed", () => {
    expect(verifyFieldWrite(19, "19", "Linked INC-0157 to PRB-0019").ok).toBe(true);
  });

  it("reports a refused link as an error", () => {
    expect(verifyFieldWrite(null, "19", "Linked INC-0157 to PRB-0019")).toMatchObject({ ok: false });
    expect(verifyFieldWrite(7, "19", "Linked INC-0157 to PRB-0019")).toMatchObject({ ok: false });
  });

  it("confirms an unlink only when the relation is gone", () => {
    expect(verifyFieldWrite(null, "none", "Unlinked").ok).toBe(true);
    expect(verifyFieldWrite(19, "none", "Unlinked").ok).toBe(false);
  });
});

describe("parseArticleLinkTarget", () => {
  it("maps each ref prefix to its record kind, any case and zero padding", () => {
    expect(parseArticleLinkTarget("INC-0042")).toEqual({ entityType: "TICKET", entityId: 42 });
    expect(parseArticleLinkTarget("req-7")).toEqual({ entityType: "TICKET", entityId: 7 });
    expect(parseArticleLinkTarget(" PRB-0019 ")).toEqual({ entityType: "PROBLEM", entityId: 19 });
    expect(parseArticleLinkTarget("chg-0025")).toEqual({ entityType: "CHANGE", entityId: 25 });
  });

  it("requires a prefix, because a bare number does not name a record kind", () => {
    expect(parseArticleLinkTarget("42")).toBeNull();
  });

  it("rejects unknown prefixes, zero, trailing text and blanks", () => {
    expect(parseArticleLinkTarget("KB-12")).toBeNull();
    expect(parseArticleLinkTarget("CHG-0")).toBeNull();
    expect(parseArticleLinkTarget("CHG-7 please")).toBeNull();
    expect(parseArticleLinkTarget("")).toBeNull();
    expect(parseArticleLinkTarget(undefined)).toBeNull();
  });
});

// Actions that report their own refusals: the rule's reason must reach the user.
describe("fromActionResult", () => {
  it("reports success with the given summary", () => {
    expect(fromActionResult({ ok: true }, "Closed CHG-0025")).toEqual({ ok: true, summary: "Closed CHG-0025", data: undefined });
  });

  it("passes the refusal reason through", () => {
    expect(fromActionResult({ ok: false, error: "Choose an outcome before closing the change." }, "Closed")).toEqual({
      ok: false,
      error: "Choose an outcome before closing the change.",
    });
  });

  it("falls back to a generic refusal when the action gave no reason", () => {
    const res = fromActionResult({ ok: false }, "Closed");
    expect(res).toMatchObject({ ok: false });
    expect(res.ok === false && res.error).toMatch(/Nothing was changed/);
  });
});

describe("clip", () => {
  it("returns null for blank text and keeps short text as is", () => {
    expect(clip("  ")).toBeNull();
    expect(clip(null)).toBeNull();
    expect(clip(" restart service ", 50)).toBe("restart service");
  });

  it("truncates long text and says so", () => {
    const out = clip("x".repeat(700), 600);
    expect(out).toContain("[truncated, 700 chars]");
    expect(out!.startsWith("x".repeat(600))).toBe(true);
  });
});
