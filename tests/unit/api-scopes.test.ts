import { describe, expect, it } from "vitest";
import {
  API_RESOURCES,
  RESOURCE_SCOPES,
  normalizeScopes,
  parseStoredScopes,
  requiredScope,
  resourceScopes,
  scopeGrants,
  scopesGranting,
  type ResourceScope,
} from "@/lib/api-scopes";

/** The check every handler made before resource scopes existed: read/write, `admin` for the history import. */
function legacyGrants(held: string[], required: ResourceScope): boolean {
  if (held.includes("admin")) return true;
  if (required === "import:write" || required === "kb:publish") return false;
  return held.includes(required.endsWith(":read") ? "read" : "write");
}

describe("scopeGrants", () => {
  it.each([["read"], ["read,write"], ["read,write,admin"], ["write"], ["admin"]])(
    "gives the legacy set %s exactly its old rights on every resource scope",
    (csv) => {
      const held = parseStoredScopes(csv);
      for (const scope of RESOURCE_SCOPES) expect(scopeGrants(held, scope), scope).toBe(legacyGrants(held, scope));
    },
  );

  it("grants a resource scope only for its own resource", () => {
    expect(scopeGrants(["tickets:write"], "tickets:write")).toBe(true);
    expect(scopeGrants(["tickets:write"], "changes:write")).toBe(false);
    expect(scopeGrants(["tickets:write"], "cmdb:read")).toBe(false);
  });

  it("lets a resource write include that resource's read, not the other way round", () => {
    expect(scopeGrants(["kb:write"], "kb:read")).toBe(true);
    expect(scopeGrants(["kb:read"], "kb:write")).toBe(false);
  });

  it("keeps the history import out of the legacy write and in admin and import:write", () => {
    expect(scopeGrants(["read", "write"], "import:write")).toBe(false);
    expect(scopeGrants(["admin"], "import:write")).toBe(true);
    expect(scopeGrants(["import:write"], "import:write")).toBe(true);
    expect(scopeGrants(["import:write"], "tickets:write")).toBe(false);
  });

  it("keeps article publishing to kb:publish and admin, and lets it include kb write and read", () => {
    expect(scopeGrants(["read", "write"], "kb:publish")).toBe(false);
    expect(scopeGrants(["kb:write"], "kb:publish")).toBe(false);
    expect(scopeGrants(["import:write"], "kb:publish")).toBe(false);
    expect(scopeGrants(["admin"], "kb:publish")).toBe(true);
    expect(scopeGrants(["kb:publish"], "kb:publish")).toBe(true);
    expect(scopeGrants(["kb:publish"], "kb:write")).toBe(true);
    expect(scopeGrants(["kb:publish"], "kb:read")).toBe(true);
    expect(scopeGrants(["kb:publish"], "tickets:write")).toBe(false);
  });

  it("grants nothing for no scopes or unknown ones", () => {
    expect(scopeGrants([], "tickets:read")).toBe(false);
    expect(scopeGrants(["tickets"], "tickets:read")).toBe(false);
  });
});

describe("normalizeScopes", () => {
  it("orders by catalog and drops duplicates and blanks", () => {
    expect(normalizeScopes(["cmdb:read", " tickets:write ", "cmdb:read", ""])).toEqual(["tickets:write", "cmdb:read"]);
  });

  it("drops resource scopes another held scope already grants", () => {
    expect(normalizeScopes(["tickets:read", "tickets:write"])).toEqual(["tickets:write"]);
    expect(normalizeScopes(["read", "cmdb:read", "tickets:write"])).toEqual(["read", "tickets:write"]);
    expect(normalizeScopes(["write", "tickets:write", "import:write"])).toEqual(["write", "tickets:write", "import:write"]);
    expect(normalizeScopes(["admin", "import:write", "kb:write"])).toEqual(["admin"]);
  });

  it("keeps a resource write that is the only way to read once a legacy write is held", () => {
    expect(normalizeScopes(["write", "tickets:write"])).toEqual(["write", "tickets:write"]);
    expect(normalizeScopes(["read", "write", "tickets:write"])).toEqual(["read", "write"]);
    expect(normalizeScopes(["write", "tickets:read"])).toEqual(["write", "tickets:read"]);
    expect(normalizeScopes(["kb:write", "kb:publish"])).toEqual(["kb:publish"]);
  });

  it("keeps the legacy sets as they are", () => {
    expect(normalizeScopes(["read", "write", "admin"])).toEqual(["read", "write", "admin"]);
  });

  it("refuses an empty selection and unknown scopes", () => {
    expect(normalizeScopes([])).toBeNull();
    expect(normalizeScopes([" "])).toBeNull();
    expect(normalizeScopes(["tickets:delete"])).toBeNull();
    expect(normalizeScopes(["directory:write"])).toBeNull();
  });
});

describe("requiredScope", () => {
  it("maps the route group to its resource and the method to the access", () => {
    expect(requiredScope("/tickets", "GET")).toBe("tickets:read");
    expect(requiredScope("/tickets/ref/{ref}/resolve", "POST")).toBe("tickets:write");
    expect(requiredScope("/assets/{id}/relations/{relation_id}", "DELETE")).toBe("cmdb:write");
    expect(requiredScope("/licenses/{id}/attachments", "post")).toBe("cmdb:write");
    expect(requiredScope("/recurring-tickets/{id}", "PATCH")).toBe("recurring:write");
    expect(requiredScope("/articles/ref/{ref}", "PUT")).toBe("kb:write");
    expect(requiredScope("/categories", "GET")).toBe("catalog:read");
    expect(requiredScope("/users", "GET")).toBe("directory:read");
    expect(requiredScope("/import/changes/{import_ref}", "PUT")).toBe("import:write");
  });

  it("needs no scope for the public paths and preflights", () => {
    expect(requiredScope("/", "GET")).toBeNull();
    expect(requiredScope("/openapi", "GET")).toBeNull();
    expect(requiredScope("/tickets", "OPTIONS")).toBeNull();
  });

  it("has no answer for a route group or access nobody decided on", () => {
    expect(requiredScope("/widgets", "GET")).toBeUndefined();
    expect(requiredScope("/constructor", "GET")).toBeUndefined();
    expect(requiredScope("/users", "POST")).toBeUndefined();
    expect(requiredScope("/import/tickets", "GET")).toBeUndefined();
  });
});

describe("scope catalog", () => {
  it("lists every resource with the accesses it offers", () => {
    expect(API_RESOURCES).toEqual(["tickets", "recurring", "problems", "changes", "cmdb", "kb", "catalog", "directory", "import"]);
    expect(resourceScopes("directory")).toEqual(["directory:read"]);
    expect(resourceScopes("import")).toEqual(["import:write"]);
    expect(resourceScopes("kb")).toEqual(["kb:read", "kb:write", "kb:publish"]);
    expect(resourceScopes("cmdb")).toEqual(["cmdb:read", "cmdb:write"]);
  });

  it("names every scope that satisfies a requirement", () => {
    expect(scopesGranting("tickets:read")).toEqual(["tickets:read", "tickets:write", "read", "admin"]);
    expect(scopesGranting("changes:write")).toEqual(["changes:write", "write", "admin"]);
    expect(scopesGranting("kb:publish")).toEqual(["kb:publish", "admin"]);
    expect(scopesGranting("import:write")).toEqual(["import:write", "admin"]);
  });
});
