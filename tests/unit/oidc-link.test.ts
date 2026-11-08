import { describe, expect, it } from "vitest";
import { decideOidcLink, externalIdFromProfile, isEmailVerified, oidcLinkConfig, type LinkCandidate } from "@/lib/oidc-link";

const precreated: LinkCandidate = {
  passwordHash: null,
  isActive: true,
  lastLoginAt: null,
  syncSourceId: "src-1",
  identityCount: 0,
};

describe("oidcLinkConfig", () => {
  it("is off by default", () => {
    expect(oidcLinkConfig({})).toBeNull();
    expect(oidcLinkConfig({ AUTH_OIDC_LINK_EXISTING: "off" })).toBeNull();
  });

  it("enables email linking and the external-id claim independently", () => {
    expect(oidcLinkConfig({ AUTH_OIDC_LINK_EXISTING: "Email_Verified" })).toEqual({ byVerifiedEmail: true, externalIdClaim: null });
    expect(oidcLinkConfig({ AUTH_OIDC_LINK_CLAIM: " ldap_id " })).toEqual({ byVerifiedEmail: false, externalIdClaim: "ldap_id" });
  });

  it("rejects an unknown mode instead of guessing", () => {
    expect(() => oidcLinkConfig({ AUTH_OIDC_LINK_EXISTING: "email" })).toThrow(/must be one of/);
  });
});

describe("isEmailVerified", () => {
  it("accepts the boolean and the string form", () => {
    expect(isEmailVerified({ email_verified: true })).toBe(true);
    expect(isEmailVerified({ email_verified: "true" })).toBe(true);
  });

  it("treats a missing or false claim as unverified", () => {
    expect(isEmailVerified({})).toBe(false);
    expect(isEmailVerified({ email_verified: false })).toBe(false);
    expect(isEmailVerified(undefined)).toBe(false);
  });
});

describe("externalIdFromProfile", () => {
  it("reads a single value, also from a dot path", () => {
    expect(externalIdFromProfile({ attrs: { guid: "abc-1" } }, "attrs.guid")).toBe("abc-1");
  });

  it("returns null for a missing or multi-valued claim", () => {
    expect(externalIdFromProfile({}, "guid")).toBeNull();
    expect(externalIdFromProfile({ guid: ["a", "b"] }, "guid")).toBeNull();
  });
});

describe("decideOidcLink", () => {
  it("links a pre-created account matched by a verified email", () => {
    expect(decideOidcLink(precreated, "email", true)).toEqual({ link: true, activate: false });
  });

  it("refuses an email match the IdP has not verified", () => {
    expect(decideOidcLink(precreated, "email", false)).toEqual({ link: false, reason: "email-not-verified" });
  });

  it("links an external-id match without a verified email", () => {
    expect(decideOidcLink(precreated, "externalId", false)).toEqual({ link: true, activate: false });
  });

  it("refuses an account with a password", () => {
    expect(decideOidcLink({ ...precreated, passwordHash: "$2a$10$x" }, "email", true)).toEqual({ link: false, reason: "has-password" });
  });

  it("refuses an account that already has an SSO identity", () => {
    expect(decideOidcLink({ ...precreated, identityCount: 1 }, "externalId", true)).toEqual({ link: false, reason: "has-identity" });
  });

  it("activates an unused inactive contact from the mail inbox", () => {
    const contact = { ...precreated, isActive: false, syncSourceId: null };
    expect(decideOidcLink(contact, "email", true)).toEqual({ link: true, activate: true });
  });

  it("does not revive an account the directory sync deactivated", () => {
    expect(decideOidcLink({ ...precreated, isActive: false }, "email", true)).toEqual({ link: false, reason: "deactivated" });
  });

  it("does not revive an inactive account that was used before", () => {
    const used = { ...precreated, isActive: false, syncSourceId: null, lastLoginAt: new Date("2026-01-01") };
    expect(decideOidcLink(used, "email", true)).toEqual({ link: false, reason: "deactivated" });
  });
});
