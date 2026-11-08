import type { Page } from "@playwright/test";

export type Failure = { source: string; target: string; reason: string };

export type CrawlResult = { visited: number; failures: Failure[] };

type CrawlOptions = {
  page: Page;
  start: string;
  maxPages: number;
  maxPerShape: number;
};

const NOT_FOUND_OR_ERROR_HEADING =
  // English and German (e2e/i18n.spec.ts crawls as German users; see messages/de/errors.ts).
  /^(Page not found|This page could not be found\.?|Something went wrong|Application error.*|Seite nicht gefunden|Etwas ist schiefgelaufen)$/;
const SKIPPED_PATHS = /^\/(api|_next)\/|\/(log-?out|sign-?out)(\/|$)/i;

/** Where the proxy sends a role away from a page it may not open. */
function deniedLanding(requested: URL, landed: URL): string | undefined {
  if (landed.pathname === requested.pathname) return undefined;
  if (landed.pathname === "/no-access") return "redirected to /no-access (link shown to a role without access)";
  if (landed.pathname === "/login") return "redirected to /login (session lost or page not public)";
  const sentToPortal = landed.pathname === "/portal" && !requested.pathname.startsWith("/portal");
  return sentToPortal ? "redirected to /portal (link shown to a role without console access)" : undefined;
}

/**
 * The page "shape" of a URL: id-like segments (anything with a digit) collapse
 * to `:id`, so `/tickets/12` and `/tickets/40` share a shape while a plain word
 * such as `/contracts/licenses` stays its own. A route pattern would lump the
 * latter into `/contracts/[id]` and hide that it is a broken link.
 */
function pageShape(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => (/\d/.test(segment) ? ":id" : segment))
    .join("/");
}

/** Internal page links of the current page, as absolute same-origin URLs without hash. */
async function pageLinks(page: Page, origin: string): Promise<URL[]> {
  const hrefs = await page.$$eval("a[href]:not([download])", (anchors) =>
    anchors.map((anchor) => (anchor as HTMLAnchorElement).href),
  );
  const urls: URL[] = [];
  for (const href of hrefs) {
    const url = safeUrl(href);
    if (!url || url.origin !== origin || SKIPPED_PATHS.test(url.pathname)) continue;
    url.hash = "";
    urls.push(url);
  }
  return urls;
}

function safeUrl(href: string): URL | undefined {
  try {
    return new URL(href);
  } catch {
    return undefined;
  }
}

/** The reason a loaded page counts as broken, or undefined when it is fine. */
async function brokenReason(page: Page, status: number, requested: URL, pageErrors: string[]): Promise<string | undefined> {
  if (status >= 400) return `HTTP ${status}`;
  const denied = deniedLanding(requested, new URL(page.url()));
  if (denied) return denied;
  if (pageErrors.length) return `uncaught page error: ${pageErrors[0]}`;
  const errorHeading = page.getByRole("heading", { name: NOT_FOUND_OR_ERROR_HEADING });
  if ((await errorHeading.count()) > 0) return `renders "${await errorHeading.first().innerText()}"`;
  return undefined;
}

/**
 * Breadth-first crawl of same-origin `a[href]` links, read-only: pages are only
 * navigated to, never clicked or submitted. Concrete URLs are capped per page
 * shape so list/detail pages with many rows stay cheap.
 */
export async function crawl({ page, start, maxPages, maxPerShape }: CrawlOptions): Promise<CrawlResult> {
  const origin = new URL(page.url()).origin;
  const queue: { url: URL; source: string }[] = [{ url: new URL(start, origin), source: "(start)" }];
  const seen = new Set<string>([queue[0].url.href]);
  const perShape = new Map<string, number>();
  const failures: Failure[] = [];
  let visited = 0;

  let pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (let next = queue.shift(); next && visited < maxPages; next = queue.shift()) {
    const shape = pageShape(next.url.pathname);
    if ((perShape.get(shape) ?? 0) >= maxPerShape) continue;
    perShape.set(shape, (perShape.get(shape) ?? 0) + 1);

    pageErrors = [];
    const response = await page.goto(next.url.href, { waitUntil: "load" });
    // Pages with open streams never go network-idle; the load event is the fallback.
    await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => undefined);
    visited++;

    const reason = await brokenReason(page, response?.status() ?? 0, next.url, pageErrors);
    if (reason) {
      failures.push({ source: next.source, target: next.url.pathname + next.url.search, reason });
      continue;
    }
    for (const link of await pageLinks(page, origin)) {
      if (seen.has(link.href)) continue;
      seen.add(link.href);
      queue.push({ url: link, source: next.url.pathname });
    }
  }
  return { visited, failures };
}
