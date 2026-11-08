import { describe, expect, it } from "vitest";
import { tokenExpired, tokenExpiry, tokenOwnerRefusal } from "@/lib/token-rules";

const now = new Date("2026-11-08T12:00:00Z");

describe("tokenExpiry", () => {
  it("never expires without a date", () => {
    expect(tokenExpiry("", now)).toBeNull();
    expect(tokenExpiry("  ", now)).toBeNull();
  });

  it("is valid through the end of the chosen day (UTC)", () => {
    expect(tokenExpiry("2027-01-31", now)).toEqual(new Date("2027-01-31T23:59:59.999Z"));
  });

  it("accepts today, which still has time left", () => {
    expect(tokenExpiry("2026-11-08", now)).toEqual(new Date("2026-11-08T23:59:59.999Z"));
  });

  it("refuses a past date, garbage and an expiry beyond the maximum", () => {
    expect(tokenExpiry("2026-11-07", now)).toEqual({ error: "The expiry date must be in the future." });
    expect(tokenExpiry("next week", now)).toEqual({ error: "Enter the expiry as a date." });
    expect(tokenExpiry("2026-13-01", now)).toEqual({ error: "Enter the expiry as a date." });
    expect(tokenExpiry("2037-01-01", now)).toEqual({ error: "A token can expire at most 3650 days from now." });
  });
});

describe("tokenOwnerRefusal", () => {
  it("lets an admin issue a token to an active service account", () => {
    expect(tokenOwnerRefusal({ isActive: true, role: "AGENT" }, "read,write")).toBeNull();
  });

  it("refuses an unknown or deactivated owner", () => {
    expect(tokenOwnerRefusal(null, "read")).toBe("Pick an existing account as the token's owner.");
    expect(tokenOwnerRefusal({ isActive: false, role: "AGENT" }, "read")).toBe("The token's owner is deactivated.");
  });

  it("keeps the admin scope to ADMIN owners", () => {
    expect(tokenOwnerRefusal({ isActive: true, role: "MANAGER" }, "read,write,admin")).toBe("Only an ADMIN account can hold the admin scope.");
    expect(tokenOwnerRefusal({ isActive: true, role: "ADMIN" }, "read,write,admin")).toBeNull();
  });
});

describe("tokenExpired", () => {
  it("is false for a token without expiry or one still valid", () => {
    expect(tokenExpired(null, now)).toBe(false);
    expect(tokenExpired(new Date("2026-11-09T00:00:00Z"), now)).toBe(false);
  });

  it("is true once the expiry has passed", () => {
    expect(tokenExpired(new Date("2026-11-08T11:59:59Z"), now)).toBe(true);
  });
});
