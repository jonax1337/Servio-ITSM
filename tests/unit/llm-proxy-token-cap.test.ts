import { describe, expect, it } from "vitest";
import {
  clampMaxTokens,
  isTokenLimitError,
  LearnedTokenCaps,
  MIN_LEARNED_TOKEN_CAP,
  parseTokenCap,
} from "@/lib/llm-proxy/token-cap";

describe("isTokenLimitError", () => {
  it("recognises both field names", () => {
    expect(isTokenLimitError("max_tokens is too large")).toBe(true);
    expect(isTokenLimitError("Invalid max_completion_tokens")).toBe(true);
    expect(isTokenLimitError("bad tool schema")).toBe(false);
  });
});

describe("parseTokenCap", () => {
  it.each([
    ["supports at most 16384 completion tokens", 16384],
    ["max_tokens must be less than or equal to 16384", 16384],
    ["max_tokens: maximum allowed value is 8192", 8192],
    ["maximum context length is 4096 tokens", 4096],
  ])("parses %s", (message, cap) => {
    expect(parseTokenCap(`${message} (you requested 32000)`, 32000)).toBe(cap);
  });

  it("ignores the requested value and unrelated numbers", () => {
    expect(parseTokenCap("max_tokens is too large: 32000", 32000)).toBeUndefined();
    expect(parseTokenCap("at most 40000", 32000)).toBeUndefined();
    expect(parseTokenCap("invalid max_tokens", 32000)).toBeUndefined();
  });
});

describe("LearnedTokenCaps", () => {
  const HOUR = 60 * 60_000;

  it("remembers a cap for an hour, then forgets it", () => {
    const caps = new LearnedTokenCaps();
    caps.learn("u|m", 16384, 0);
    expect(caps.get("u|m", HOUR - 1)).toBe(16384);
    expect(caps.get("u|m", HOUR)).toBeUndefined();
  });

  it("does not learn caps below MIN_LEARNED_TOKEN_CAP", () => {
    const caps = new LearnedTokenCaps();
    caps.learn("u|m", MIN_LEARNED_TOKEN_CAP - 1, 0);
    expect(caps.get("u|m", 0)).toBeUndefined();
    caps.learn("u|m", MIN_LEARNED_TOKEN_CAP, 0);
    expect(caps.get("u|m", 0)).toBe(MIN_LEARNED_TOKEN_CAP);
  });
});

describe("clampMaxTokens", () => {
  it("keeps the request without a learned cap and lowers it with one", () => {
    expect(clampMaxTokens(32000, undefined)).toBe(32000);
    expect(clampMaxTokens(32000, 16384)).toBe(16384);
    expect(clampMaxTokens(4000, 16384)).toBe(4000);
  });
});
