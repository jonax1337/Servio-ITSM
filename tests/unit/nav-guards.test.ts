import { describe, expect, it } from "vitest";
import { consoleNav, filterNav } from "@/lib/nav";
import { requiredRoleFor, isPublicPath, isPortalPath } from "@/lib/route-guard";

describe("portal namespaces (reachable for USER)", () => {
  it("covers the portal pages and the APIs the portal calls", () => {
    for (const path of ["/portal", "/portal/tickets/7", "/api/portal/assistant", "/api/portal/search", "/api/files/upload", "/api/files/abc", "/api/files/abc/preview"]) {
      expect(isPortalPath(path), path).toBe(true);
    }
  });

  it("keeps console pages, console APIs and look-alike prefixes out", () => {
    for (const path of ["/", "/tickets", "/settings", "/api/search", "/api/export", "/api/assistant/chat", "/api/dashboard/widget", "/portalx", "/api/filesystem"]) {
      expect(isPortalPath(path), path).toBe(false);
    }
  });
});

describe("public route namespaces", () => {
  it("serves brand icons and manifests before login", () => {
    expect(isPublicPath("/brand/servio/site.webmanifest")).toBe(true);
    expect(isPublicPath("/brand/sable/icon-512.png")).toBe(true);
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/survey/token")).toBe(true);
  });

  it("keeps protected routes and similarly named prefixes private", () => {
    for (const path of ["/settings", "/assistant", "/tickets", "/brand-settings", "/surveypayload", "/api/v10/tickets", "/reports/export/123.png"]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });
});

describe("filterNav", () => {
  it("admins see everything", () => {
    const groups = filterNav(consoleNav, "ADMIN");
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/audit");
    expect(hrefs).toContain("/settings");
    expect(hrefs).toContain("/assistant");
  });

  it("agents don't see MANAGER/ADMIN items but DO see their macros", () => {
    const hrefs = filterNav(consoleNav, "AGENT").flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).not.toContain("/audit");
    expect(hrefs).not.toContain("/automations");
    expect(hrefs).toContain("/settings/macros"); // personal macros are agent-level
    expect(hrefs).toContain("/assistant");
  });

  it("managers see automations + settings but not the audit log", () => {
    const hrefs = filterNav(consoleNav, "MANAGER").flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/automations");
    expect(hrefs).toContain("/settings");
    expect(hrefs).not.toContain("/audit");
  });

  it("a plain USER keeps the base console items but no escalated ones", () => {
    // filterNav only hides ESCALATED items; base items have no minRole because
    // console access itself is guarded by the middleware/route-guard layer.
    const hrefs = filterNav(consoleNav, "USER").flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/tickets");
    expect(hrefs).not.toContain("/audit");
    expect(hrefs).not.toContain("/settings");
    expect(hrefs).not.toContain("/automations");
  });
});

describe("requiredRoleFor (middleware mirror)", () => {
  it("keeps the agent default", () => {
    expect(requiredRoleFor("/tickets")).toBe("AGENT");
    expect(requiredRoleFor("/tickets/12")).toBe("AGENT");
  });

  it("escalates admin areas", () => {
    expect(requiredRoleFor("/audit")).toBe("ADMIN");
    expect(requiredRoleFor("/settings/general")).toBe("MANAGER");
    expect(requiredRoleFor("/automations")).toBe("MANAGER");
  });

  it("longest prefix wins: macros are agent-reachable under /settings", () => {
    expect(requiredRoleFor("/settings/macros")).toBe("AGENT");
    expect(requiredRoleFor("/settings")).toBe("MANAGER");
    expect(requiredRoleFor("/settings/api")).toBe("MANAGER");
  });

  it("matches the nav gating (consistency contract)", () => {
    // Every nav item's minRole must equal the middleware's required role.
    for (const group of consoleNav) {
      for (const item of group.items) {
        const routeRole = requiredRoleFor(item.href);
        const navRole = item.minRole ?? "AGENT";
        expect(`${item.href}: nav=${navRole} route=${routeRole}`).toBe(`${item.href}: nav=${navRole} route=${navRole}`);
      }
    }
  });
});
