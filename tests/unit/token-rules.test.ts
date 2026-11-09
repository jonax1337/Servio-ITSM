import { describe, expect, it } from "vitest";
import { tokenExpired, tokenExpiry, tokenOwnerRefusal, tokenScopes } from "@/lib/token-rules";

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
    expect(tokenOwnerRefusal({ isActive: true, role: "AGENT" }, ["read", "write"])).toBeNull();
  });

  it("refuses an unknown or deactivated owner", () => {
    expect(tokenOwnerRefusal(null, ["read"])).toBe("Pick an existing account as the token's owner.");
    expect(tokenOwnerRefusal({ isActive: false, role: "AGENT" }, ["read"])).toBe("The token's owner is deactivated.");
  });

  it("keeps the admin scope to ADMIN owners", () => {
    expect(tokenOwnerRefusal({ isActive: true, role: "MANAGER" }, ["read", "write", "admin"])).toBe("Only an ADMIN account can hold the admin scope.");
    expect(tokenOwnerRefusal({ isActive: true, role: "ADMIN" }, ["read", "write", "admin"])).toBeNull();
  });

  it("keeps the privileged import:write scope to ADMIN owners", () => {
    expect(tokenOwnerRefusal({ isActive: true, role: "MANAGER" }, ["import:write"])).toBe("Only an ADMIN account can hold the import:write scope.");
    expect(tokenOwnerRefusal({ isActive: true, role: "ADMIN" }, ["import:write"])).toBeNull();
  });

  it("lets any active owner hold resource scopes", () => {
    expect(tokenOwnerRefusal({ isActive: true, role: "AGENT" }, ["tickets:write", "cmdb:read"])).toBeNull();
  });
});

describe("tokenScopes", () => {
  it("issues the presets with their legacy scope sets", () => {
    expect(tokenScopes("read", [])).toEqual(["read"]);
    expect(tokenScopes("write", [])).toEqual(["read", "write"]);
    expect(tokenScopes("admin", [])).toEqual(["read", "write", "admin"]);
  });

  it("ignores a custom selection sent along with a preset", () => {
    expect(tokenScopes("read", ["tickets:write"])).toEqual(["read"]);
  });

  it("issues a custom token with the normalised selection", () => {
    expect(tokenScopes("custom", ["tickets:write", "tickets:read", "directory:read"])).toEqual(["tickets:write", "directory:read"]);
  });

  it("refuses an empty or unknown custom selection", () => {
    expect(tokenScopes("custom", [])).toEqual({ error: "Pick at least one scope." });
    expect(tokenScopes("custom", [""])).toEqual({ error: "Pick at least one scope." });
    expect(tokenScopes("custom", ["tickets:write", "tickets:admin"])).toEqual({ error: "Pick only scopes from the list." });
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
