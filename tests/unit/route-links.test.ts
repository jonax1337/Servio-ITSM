import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APPROVAL_ENTITY_META,
  APPROVAL_ENTITY_TYPES,
  ARTICLE_LINK_ENTITY_TYPES,
} from "@/lib/constants";
import { linkedRecordHref } from "@/lib/article-rules";
import { recordRefHref } from "@/lib/inline-badge";
import { collectLinkTargets, normalizeTarget, type LinkTarget } from "../support/link-targets";
import {
  buildRouteManifest,
  DYNAMIC,
  matchesAnyRoute,
  matchesRoute,
  parseRoute,
} from "../support/route-manifest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Links that are broken today and wait for a decision, keyed `file:line -> target`
 * (as printed by a failure) with a one-line reason. Auth.js endpoints under
 * `/api/auth/*` need no entry: they resolve through the `[...nextauth]` catch-all.
 */
const KNOWN_BROKEN: Readonly<Record<string, string>> = {};

const D = DYNAMIC;

describe("route matcher", () => {
  it("matches a static path exactly", () => {
    expect(matchesRoute("/tickets/new", parseRoute("/tickets/new"))).toBe(true);
    expect(matchesRoute("/tickets", parseRoute("/tickets/new"))).toBe(false);
    expect(matchesRoute("/tickets/new/extra", parseRoute("/tickets/new"))).toBe(false);
  });

  it("matches the root route only for /", () => {
    expect(matchesRoute("/", parseRoute("/"))).toBe(true);
    expect(matchesRoute("/tickets", parseRoute("/"))).toBe(false);
  });

  it("lets a [param] segment take one segment, concrete or interpolated", () => {
    const route = parseRoute("/tickets/[id]");
    expect(matchesRoute("/tickets/42", route)).toBe(true);
    expect(matchesRoute(`/tickets/${D}`, route)).toBe(true);
    expect(matchesRoute("/tickets", route)).toBe(false);
    expect(matchesRoute("/tickets/42/edit", route)).toBe(false);
  });

  it("lets [...slug] take one or more segments and [[...slug]] zero or more", () => {
    expect(matchesRoute("/api/auth/signin", parseRoute("/api/auth/[...nextauth]"))).toBe(true);
    expect(matchesRoute("/api/auth/callback/credentials", parseRoute("/api/auth/[...nextauth]"))).toBe(true);
    expect(matchesRoute("/api/auth", parseRoute("/api/auth/[...nextauth]"))).toBe(false);
    expect(matchesRoute("/docs", parseRoute("/docs/[[...slug]]"))).toBe(true);
    expect(matchesRoute("/docs/a/b", parseRoute("/docs/[[...slug]]"))).toBe(true);
  });

  it("lets an interpolated segment resolve to any route segment it could expand to", () => {
    expect(matchesRoute(`/settings/${D}`, parseRoute("/settings/macros"))).toBe(true);
    expect(matchesRoute(`/tickets/${D}/edit`, parseRoute("/tickets/[id]/edit"))).toBe(true);
    expect(matchesRoute(`/a-${D}`, parseRoute("/a-b"))).toBe(true);
    expect(matchesRoute(`/a-${D}`, parseRoute("/c-b"))).toBe(false);
  });

  it("rejects a path that exists nowhere", () => {
    const routes = [parseRoute("/tickets"), parseRoute("/tickets/[id]")];
    expect(matchesAnyRoute("/ticket/12", routes)).toBe(false);
    expect(matchesAnyRoute("/tickets/12", routes)).toBe(true);
  });
});

describe("normalizeTarget", () => {
  it("drops the query string and the hash", () => {
    expect(normalizeTarget("/tickets?status=OPEN")).toBe("/tickets");
    expect(normalizeTarget(`/tickets/${D}#comments`)).toBe(`/tickets/${D}`);
  });

  it("drops a glued interpolation, which is a query-string suffix", () => {
    expect(normalizeTarget(`/tickets${D}`)).toBe("/tickets");
    expect(normalizeTarget(`/tickets/${D}`)).toBe(`/tickets/${D}`);
  });

  it("trims trailing slashes and keeps the root", () => {
    expect(normalizeTarget("/tickets/")).toBe("/tickets");
    expect(normalizeTarget("/")).toBe("/");
  });

  it("reads a literal [param] segment as an interpolation", () => {
    expect(normalizeTarget("/tickets/[id]")).toBe(`/tickets/${D}`);
  });

  it("ignores external and protocol-relative targets", () => {
    expect(normalizeTarget("https://example.com/x")).toBeNull();
    expect(normalizeTarget("//example.com/x")).toBeNull();
    expect(normalizeTarget("tickets")).toBeNull();
  });
});

describe("route manifest", () => {
  const routes = buildRouteManifest(REPO_ROOT);

  it("strips route groups and reads dynamic segments from app/", () => {
    const patterns = routes.map((route) => route.pattern);
    expect(patterns).toContain("/");
    expect(patterns).toContain("/tickets/[id]");
    expect(patterns).toContain("/portal/tickets/[id]");
    expect(patterns).toContain("/api/auth/[...nextauth]");
    expect(patterns.some((pattern) => pattern.includes("("))).toBe(false);
  });

  it("includes metadata files and static files under public/", () => {
    const patterns = routes.map((route) => route.pattern);
    expect(patterns).toContain("/opengraph-image.png");
    expect(patterns).toContain("/favicon.ico");
    expect(patterns).toContain("/brand/servio/favicon.svg");
  });
});

describe("internal links in the source", () => {
  const routes = buildRouteManifest(REPO_ROOT);
  const targets = collectLinkTargets(REPO_ROOT);

  function resolves({ target, isBase }: LinkTarget): boolean {
    return matchesAnyRoute(target, routes) || (isBase && matchesAnyRoute(`${target}/${D}`, routes));
  }

  const describeTarget = (link: LinkTarget) => `${link.file}:${link.line} -> ${link.target.replaceAll(D, "${…}")}`;

  it("finds the links the scan is built for", () => {
    const found = new Set(targets.map((link) => link.target));
    expect(found).toContain("/tickets");
    expect(found).toContain(`/tickets/${D}`);
    expect(found).toContain("/login");
    expect(targets.length).toBeGreaterThan(300);
  });

  it("every link target resolves to a page, route handler or static file", () => {
    const broken = targets
      .filter((link) => !resolves(link))
      .map(describeTarget)
      .filter((entry) => !(entry in KNOWN_BROKEN));
    expect(broken, `Links to routes that do not exist:\n${broken.join("\n")}`).toEqual([]);
  });

  it("KNOWN_BROKEN lists only links that are still broken", () => {
    const stillBroken = new Set(targets.filter((link) => !resolves(link)).map(describeTarget));
    const fixed = Object.keys(KNOWN_BROKEN).filter((entry) => !stillBroken.has(entry));
    expect(fixed, "Remove these from KNOWN_BROKEN, they resolve now:").toEqual([]);
  });
});

describe("entity types map to existing routes", () => {
  const routes = buildRouteManifest(REPO_ROOT);

  it.each(APPROVAL_ENTITY_TYPES)("approval entity %s links to a detail page", (type) => {
    expect(matchesAnyRoute(`${APPROVAL_ENTITY_META[type].path}/42`, routes)).toBe(true);
  });

  it.each(ARTICLE_LINK_ENTITY_TYPES)("knowledge-article link entity %s links to a detail page", (type) => {
    expect(matchesAnyRoute(linkedRecordHref(type, 42), routes)).toBe(true);
  });

  it.each(["INC", "REQ", "PRB", "CHG"])("inline record reference %s-0042 links to a detail page", (prefix) => {
    const href = recordRefHref(`${prefix}-0042`);
    expect(href).not.toBeNull();
    expect(matchesAnyRoute(href as string, routes)).toBe(true);
  });
});
