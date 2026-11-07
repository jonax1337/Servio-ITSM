import { describe, expect, it } from "vitest";
import { claimValues, oidcRoleConfig, parseRoleMap, resolveOidcRole, shouldSyncRole } from "@/lib/oidc-roles";

const cfg = (env: Record<string, string>) => oidcRoleConfig(env)!;

describe("parseRoleMap", () => {
  it("parses comma and newline separated entries, case-insensitive", () => {
    const map = parseRoleMap("IT-Admins=admin,\nservice-desk = AGENT");
    expect(map.get("it-admins")).toBe("ADMIN");
    expect(map.get("service-desk")).toBe("AGENT");
  });

  it("strips the leading slash of Keycloak group paths", () => {
    expect(parseRoleMap("/it/admins=ADMIN").get("it/admins")).toBe("ADMIN");
  });

  it("keeps the higher role when a group is listed twice", () => {
    expect(parseRoleMap("ops=AGENT,ops=MANAGER,ops=USER").get("ops")).toBe("MANAGER");
  });

  it("rejects unknown roles and malformed entries instead of guessing", () => {
    expect(() => parseRoleMap("ops=SUPERUSER")).toThrow(/needs one of/);
    expect(() => parseRoleMap("ops")).toThrow(/group=ROLE/);
  });
});

describe("oidcRoleConfig", () => {
  it("is off without a role map", () => {
    expect(oidcRoleConfig({})).toBeNull();
    expect(oidcRoleConfig({ AUTH_OIDC_ROLE_MAP: " " })).toBeNull();
  });

  it("defaults to the groups claim, USER fallback and sync on every login", () => {
    expect(cfg({ AUTH_OIDC_ROLE_MAP: "a=ADMIN" })).toMatchObject({ claim: "groups", defaultRole: "USER", sync: "login" });
  });

  it("rejects an invalid default role or sync mode", () => {
    expect(() => oidcRoleConfig({ AUTH_OIDC_ROLE_MAP: "a=ADMIN", AUTH_OIDC_DEFAULT_ROLE: "ROOT" })).toThrow();
    expect(() => oidcRoleConfig({ AUTH_OIDC_ROLE_MAP: "a=ADMIN", AUTH_OIDC_ROLE_SYNC: "sometimes" })).toThrow();
  });
});

describe("claimValues", () => {
  it("follows a dot path", () => {
    expect(claimValues({ realm_access: { roles: ["a", "b"] } }, "realm_access.roles")).toEqual(["a", "b"]);
  });

  it("returns null for a missing claim but [] for an empty one", () => {
    expect(claimValues({}, "groups")).toBeNull();
    expect(claimValues({ groups: [] }, "groups")).toEqual([]);
  });

  it("accepts a space- or comma-separated string", () => {
    expect(claimValues({ roles: "a, b c" }, "roles")).toEqual(["a", "b", "c"]);
  });
});

describe("resolveOidcRole", () => {
  const config = cfg({ AUTH_OIDC_ROLE_MAP: "it-admins=ADMIN,desk=AGENT" });

  it("picks the highest mapped role", () => {
    expect(resolveOidcRole({ groups: ["desk", "/it-admins"] }, config)).toBe("ADMIN");
  });

  it("falls back to the default role when nothing matches", () => {
    expect(resolveOidcRole({ groups: ["staff"] }, config)).toBe("USER");
    expect(resolveOidcRole({ groups: ["staff"] }, cfg({ AUTH_OIDC_ROLE_MAP: "x=ADMIN", AUTH_OIDC_DEFAULT_ROLE: "agent" }))).toBe("AGENT");
  });

  it("leaves the role alone when the claim is missing (misconfigured mapper)", () => {
    expect(resolveOidcRole({ email: "a@b" }, config)).toBeNull();
  });
});

describe("shouldSyncRole", () => {
  it("syncs every login by default, only the first with signup mode", () => {
    expect(shouldSyncRole(cfg({ AUTH_OIDC_ROLE_MAP: "a=ADMIN" }), false)).toBe(true);
    const signup = cfg({ AUTH_OIDC_ROLE_MAP: "a=ADMIN", AUTH_OIDC_ROLE_SYNC: "signup" });
    expect(shouldSyncRole(signup, false)).toBe(false);
    expect(shouldSyncRole(signup, true)).toBe(true);
  });
});
