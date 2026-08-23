import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, encryptionAvailable } from "@/lib/crypto";

// Key comes from tests/setup.ts (32-byte hex).
describe("settings secret encryption", () => {
  it("reports the key as available", () => {
    expect(encryptionAvailable()).toBe(true);
  });

  it("round-trips a secret", () => {
    const blob = encryptSecret("s3cr3t-smtp-password");
    expect(blob).not.toContain("s3cr3t");
    expect(decryptSecret(blob)).toBe("s3cr3t-smtp-password");
  });

  it("produces a fresh IV per encryption (non-deterministic)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("returns null for garbage input", () => {
    expect(decryptSecret("")).toBeNull();
    expect(decryptSecret("not-a-blob")).toBeNull();
    expect(decryptSecret("AAAA:BBBB:CCCC")).toBeNull();
  });

  it("returns null for a tampered ciphertext (GCM auth)", () => {
    const blob = encryptSecret("attack at dawn");
    const parts = blob.split(":");
    // Flip bytes in the ciphertext segment.
    const flipped = Buffer.from(parts[2], "base64");
    flipped[0] ^= 0xff;
    parts[2] = flipped.toString("base64");
    expect(decryptSecret(parts.join(":"))).toBeNull();
  });

  it("returns null when encrypted under a DIFFERENT key (rotation)", () => {
    const blob = encryptSecret("rotated-away");
    const prev = process.env.SETTINGS_ENCRYPTION_KEY;
    process.env.SETTINGS_ENCRYPTION_KEY = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
    try {
      expect(decryptSecret(blob)).toBeNull();
    } finally {
      process.env.SETTINGS_ENCRYPTION_KEY = prev;
    }
  });
});
