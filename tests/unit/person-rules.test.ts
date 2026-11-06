import { describe, expect, it } from "vitest";
import {
  isEmailShape,
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  passwordError,
} from "@/lib/person-rules";

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
  });
});

describe("isEmailShape", () => {
  it.each(["a@b.co", "jane.doe+tag@sub.example.com"])("accepts %s", (email) => {
    expect(isEmailShape(email)).toBe(true);
  });

  it.each(["", "plain", "a@b", "a b@c.de", "@c.de", "a@@c.de", "a@c .de"])("rejects %j", (email) => {
    expect(isEmailShape(email)).toBe(false);
  });
});

describe("passwordError", () => {
  it("rejects anything shorter than the minimum", () => {
    expect(passwordError("x".repeat(MIN_PASSWORD_LENGTH - 1))).toContain(`${MIN_PASSWORD_LENGTH} characters`);
  });

  it("accepts the minimum length exactly", () => {
    expect(passwordError("x".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
  });

  it("accepts the byte limit and rejects one byte beyond it", () => {
    expect(passwordError("x".repeat(MAX_PASSWORD_BYTES))).toBeNull();
    expect(passwordError("x".repeat(MAX_PASSWORD_BYTES + 1))).toContain(`${MAX_PASSWORD_BYTES} bytes`);
  });

  it("counts bytes, not characters, for the upper bound", () => {
    // 37 two-byte characters = 74 bytes, but only 37 characters.
    expect(passwordError("ü".repeat(37))).toContain("bytes");
  });
});
