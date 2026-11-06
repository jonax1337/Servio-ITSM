import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * Placeholder for a `${…}` template expression inside a link target. It stands
 * for "some non-empty text" and may match any route segment it could expand to.
 */
export const DYNAMIC = "";

type RouteSegment =
  | { kind: "static"; text: string }
  | { kind: "dynamic" }
  | { kind: "catchAll" }
  | { kind: "optionalCatchAll" };

export type Route = { pattern: string; segments: RouteSegment[] };

const ROUTE_FILE = /^(page|route)\.(tsx?|jsx?|mdx)$/;
const STATIC_METADATA_FILE = /^(favicon|icon|apple-icon|opengraph-image|twitter-image)\.[a-z0-9]+$/;
const GENERATED_METADATA_URL: Record<string, string> = {
  sitemap: "sitemap.xml",
  robots: "robots.txt",
  manifest: "manifest.webmanifest",
};
const CODE_EXTENSION = /\.(tsx?|jsx?)$/;

function parseSegment(text: string): RouteSegment {
  if (/^\[\[\.\.\..+\]\]$/.test(text)) return { kind: "optionalCatchAll" };
  if (/^\[\.\.\..+\]$/.test(text)) return { kind: "catchAll" };
  if (/^\[.+\]$/.test(text)) return { kind: "dynamic" };
  return { kind: "static", text };
}

/** A route from its URL pattern, e.g. `/tickets/[id]`. */
export function parseRoute(pattern: string): Route {
  const segments = pattern.split("/").filter(Boolean);
  return { pattern, segments: segments.map(parseSegment) };
}

/** URL path segments of a file below the `app/` (or `public/`) root, or null when it is not a route. */
function appFileUrl(relativeFile: string): string[] | null {
  const parts = relativeFile.split(path.sep);
  const file = parts.pop() as string;
  const dirs = parts.filter((dir) => !/^\(.+\)$/.test(dir) && !dir.startsWith("@"));
  if (parts.some((dir) => dir.startsWith("_"))) return null;

  if (ROUTE_FILE.test(file)) return dirs;
  if (STATIC_METADATA_FILE.test(file)) return [...dirs, file];
  const generated = GENERATED_METADATA_URL[file.replace(CODE_EXTENSION, "")];
  return generated && CODE_EXTENSION.test(file) ? [...dirs, generated] : null;
}

function filesBelow(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)));
}

/**
 * Every URL the app serves: pages, route handlers and metadata files under
 * `app/`, plus the static files under `public/`.
 */
export function buildRouteManifest(repoRoot: string): Route[] {
  const appRoutes = filesBelow(path.join(repoRoot, "app"))
    .map(appFileUrl)
    .filter((segments): segments is string[] => segments !== null);
  const publicRoutes = filesBelow(path.join(repoRoot, "public")).map((file) => file.split(path.sep));
  return [...appRoutes, ...publicRoutes].map((segments) => parseRoute(`/${segments.join("/")}`));
}

function segmentMatches(target: string, route: RouteSegment): boolean {
  if (route.kind !== "static") return true;
  if (!target.includes(DYNAMIC)) return target === route.text;
  const escaped = target.split(DYNAMIC).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".+")}$`).test(route.text);
}

function matchFrom(target: string[], at: number, route: RouteSegment[], routeAt: number): boolean {
  const segment = route[routeAt];
  if (!segment) return at === target.length;
  if (segment.kind === "optionalCatchAll") return true;
  if (segment.kind === "catchAll") return at < target.length;
  return at < target.length && segmentMatches(target[at], segment) && matchFrom(target, at + 1, route, routeAt + 1);
}

/**
 * Whether `target` (a path whose `${…}` expressions are {@link DYNAMIC}
 * placeholders, with no query or hash) can resolve to `route`.
 */
export function matchesRoute(target: string, route: Route): boolean {
  const segments = target === "/" ? [] : target.slice(1).split("/");
  return matchFrom(segments, 0, route.segments, 0);
}

export function matchesAnyRoute(target: string, routes: readonly Route[]): boolean {
  return routes.some((route) => matchesRoute(target, route));
}

const SEGMENT_RANK = { static: 0, dynamic: 1, catchAll: 2, optionalCatchAll: 3 } as const;

/** Orders routes so the most specific one (static before dynamic before catch-all, segment by segment) comes first. */
function compareSpecificity(a: Route, b: Route): number {
  const length = Math.max(a.segments.length, b.segments.length);
  for (let i = 0; i < length; i++) {
    const rankA = a.segments[i] ? SEGMENT_RANK[a.segments[i].kind] : -1;
    const rankB = b.segments[i] ? SEGMENT_RANK[b.segments[i].kind] : -1;
    if (rankA !== rankB) return rankA - rankB;
  }
  return 0;
}

/** The route Next.js serves `pathname` from: the most specific match, or undefined when nothing matches. */
export function findRoute(pathname: string, routes: readonly Route[]): Route | undefined {
  return routes.filter((route) => matchesRoute(pathname, route)).sort(compareSpecificity)[0];
}
