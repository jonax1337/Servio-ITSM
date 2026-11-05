import { tool } from "ai";
import { z } from "zod";
import { safeFetch } from "@/lib/safe-fetch";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { ticketRef, problemRef, changeRef } from "@/lib/constants";

/**
 * Web tools for the AI chat agent. Search uses a real provider API when one is
 * configured (Tavily or Brave — clean, LLM-friendly results), otherwise falls
 * back to the keyless DuckDuckGo HTML endpoint (data stays self-hosted, but
 * best-effort scraping that can be empty if DDG rate-limits). See `webSearch`.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

/** DDG wraps result links as //duckduckgo.com/l/?uddg=<encoded target>. Unwrap it. */
function unwrapDdgUrl(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      /* fall through */
    }
  }
  return href.startsWith("//") ? "https:" + href : href;
}

export type WebResult = { title: string; url: string; snippet: string };

export async function duckDuckGoSearch(query: string, limit = 5): Promise<WebResult[]> {
  let html = "";
  try {
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
      body: "q=" + encodeURIComponent(query),
    });
    html = await res.text();
  } catch {
    return [];
  }

  const snippets: string[] = [];
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html)) !== null) snippets.push(stripTags(sm[1]));

  const results: WebResult[] = [];
  const linkRe = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let lm: RegExpExecArray | null;
  let i = 0;
  while ((lm = linkRe.exec(html)) !== null && results.length < limit) {
    const url = unwrapDdgUrl(lm[1]);
    const title = stripTags(lm[2]);
    if (title && url) results.push({ title, url, snippet: snippets[i] ?? "" });
    i++;
  }
  return results;
}

/** Tavily — an LLM-oriented search API (clean title/url/content). */
async function tavilySearch(query: string, limit: number, key: string): Promise<WebResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: key, query, max_results: limit, search_depth: "basic" }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return (data.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: (r.content ?? "").slice(0, 500) }));
}

/** Brave Search API (web results with descriptions). */
async function braveSearch(query: string, limit: number, key: string): Promise<WebResult[]> {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
    { headers: { "X-Subscription-Token": key, Accept: "application/json" } },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
  return (data.web?.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({ title: stripTags(r.title ?? r.url!), url: r.url!, snippet: stripTags(r.description ?? "") }));
}

/**
 * Web search with a real provider when configured, else DuckDuckGo. Set
 * `WEB_SEARCH_PROVIDER` (tavily|brave|duckduckgo|auto — default auto) and the
 * matching `TAVILY_API_KEY` / `BRAVE_API_KEY` (Settings or env). A provider error
 * or empty result quietly falls back to DDG so search never hard-fails.
 */
export async function webSearch(query: string, limit = 6): Promise<WebResult[]> {
  const provider = ((await getSetting("WEB_SEARCH_PROVIDER")) ?? "auto").toLowerCase();
  const [tavilyKey, braveKey] = await Promise.all([
    getSetting("TAVILY_API_KEY"),
    getSetting("BRAVE_API_KEY"),
  ]);
  try {
    if ((provider === "tavily" || provider === "auto") && tavilyKey) {
      const r = await tavilySearch(query, limit, tavilyKey);
      if (r.length) return r;
    }
    if ((provider === "brave" || provider === "auto") && braveKey) {
      const r = await braveSearch(query, limit, braveKey);
      if (r.length) return r;
    }
  } catch {
    /* provider failed — fall back to DDG below */
  }
  return duckDuckGoSearch(query, limit);
}

export async function fetchUrlText(url: string, maxChars = 6000): Promise<string> {
  // This tool is reachable from the USER-scoped portal, so the URL is fully
  // attacker-controlled. safeFetch closes the TOCTOU/DNS-rebinding hole: it
  // resolves once, pins the socket to the validated IP, verifies the connected
  // peer, refuses redirects (so a public page can't 302 us onto an internal
  // host), and caps the body + timeout.
  let res: Awaited<ReturnType<typeof safeFetch>>;
  try {
    res = await safeFetch(url, {
      headers: { "User-Agent": UA },
      timeoutMs: 10_000,
      maxBytes: 2 * 1024 * 1024,
    });
  } catch (e) {
    return `Failed to fetch: ${e instanceof Error ? e.message : "error"}`;
  }
  const ct = res.headers["content-type"] ?? "";
  if (!ct.includes("text/html") && !ct.includes("text/plain")) {
    return `Unsupported content type: ${ct || "unknown"}`;
  }
  const html = res.text;
  // Drop script/style AND common boilerplate (nav/header/footer/aside/forms) so
  // the model reads the article body, not the chrome — then strip to plain text.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "");
  const text = stripTags(cleaned);
  return text.slice(0, maxChars) || "(no readable text)";
}

export const webSearchTool = tool({
  description:
    "Search the public web for current or external information that is NOT in the org's own data. Returns top results with title, url and snippet; call fetch_url on a result to read its full page when the snippet isn't enough.",
  inputSchema: z.object({ query: z.string().describe("the search query") }),
  execute: async ({ query }) => {
    const results = await webSearch(query, 6);
    return results.length ? results : [{ title: "No results found", url: "", snippet: "" }];
  },
});

export const fetchUrlTool = tool({
  description:
    "Fetch and read the main text of a web page by URL (e.g. one of the search results) when the snippet isn't enough.",
  inputSchema: z.object({ url: z.string().describe("the http(s) URL to read") }),
  execute: async ({ url }) => ({ text: await fetchUrlText(url) }),
});

/**
 * AGENT-ONLY trust boundary: this returns INTERNAL-visibility articles (it does
 * not filter on `visibility`), so it must NEVER be added to the USER-scoped
 * portal tool set. The portal exposes only published PUBLIC articles via its own
 * read-only path. Keep this out of any portal/USER agent wiring.
 */
export const knowledgeSearchTool = tool({
  description:
    "Search the internal Knowledge Base (published how-to and troubleshooting articles) for guidance and known solutions. Prefer this over the web for anything the company documents itself.",
  inputSchema: z.object({ query: z.string().describe("keywords to search KB articles for") }),
  execute: async ({ query }) => {
    const rows = await db.article.findMany({
      where: {
        status: "PUBLISHED",
        OR: [{ title: { contains: query } }, { excerpt: { contains: query } }, { body: { contains: query } }],
      },
      take: 5,
      orderBy: { views: "desc" },
      select: { title: true, slug: true, excerpt: true, visibility: true },
    });
    return rows.length
      ? rows.map((r) => ({ title: r.title, url: `/knowledge/${r.slug}`, excerpt: r.excerpt ?? "", audience: r.visibility }))
      : [{ title: "No matching KB articles", url: "", excerpt: "", audience: "" }];
  },
});

export const ticketSearchTool = tool({
  description:
    "Search past and current tickets by keyword (title, description, and comments) to find similar issues and how they were resolved or routed.",
  inputSchema: z.object({ query: z.string().describe("keywords to search tickets for") }),
  execute: async ({ query }) => {
    const rows = await db.ticket.findMany({
      where: {
        OR: [
          { title: { contains: query } },
          { description: { contains: query } },
          { comments: { some: { body: { contains: query } } } },
        ],
      },
      take: 6,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        priority: true,
        resolutionCode: true,
        group: { select: { name: true } },
        category: { select: { name: true } },
      },
    });
    return rows.length
      ? rows.map((t) => ({
          ref: ticketRef(t.id, t.type),
          title: t.title,
          status: t.status,
          priority: t.priority,
          team: t.group?.name ?? null,
          category: t.category?.name ?? null,
          resolution: t.resolutionCode ?? null,
        }))
      : [{ ref: "", title: "No matching tickets", status: "", priority: "", team: null, category: null, resolution: null }];
  },
});

export const problemSearchTool = tool({
  description:
    "Search Problem records (root-cause investigations & known errors) by keyword, including their comments. Use for 'is there a known error / root cause / workaround for this' and recurring incidents. For one problem in full (linked incidents, comments) use problem_get.",
  inputSchema: z.object({ query: z.string().describe("keywords to search problems for") }),
  execute: async ({ query }) => {
    const rows = await db.problem.findMany({
      where: {
        OR: [
          { title: { contains: query } },
          { description: { contains: query } },
          { comments: { some: { body: { contains: query } } } },
        ],
      },
      take: 5,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, title: true, status: true, priority: true, rootCause: true, workaround: true,
        group: { select: { name: true } },
      },
    });
    return rows.length
      ? rows.map((p) => ({
          ref: problemRef(p.id),
          title: p.title,
          status: p.status,
          priority: p.priority,
          rootCause: p.rootCause ?? null,
          workaround: p.workaround ?? null,
          team: p.group?.name ?? null,
        }))
      : [{ ref: "", title: "No matching problems", status: "", priority: "", rootCause: null, workaround: null, team: null }];
  },
});

export const changeSearchTool = tool({
  description:
    "Search Change records (planned changes & maintenance) by keyword, including their comments. Use for 'was there a recent change that could have caused this' and scheduled work. For one change in full (plans, CAB approvals, linked tickets) use change_get.",
  inputSchema: z.object({ query: z.string().describe("keywords to search changes for") }),
  execute: async ({ query }) => {
    const rows = await db.change.findMany({
      where: {
        OR: [
          { title: { contains: query } },
          { description: { contains: query } },
          { comments: { some: { body: { contains: query } } } },
        ],
      },
      take: 5,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, title: true, status: true, type: true, risk: true, plannedStart: true,
        group: { select: { name: true } },
      },
    });
    return rows.length
      ? rows.map((c) => ({
          ref: changeRef(c.id),
          title: c.title,
          status: c.status,
          type: c.type,
          risk: c.risk,
          plannedStart: c.plannedStart ? c.plannedStart.toISOString().slice(0, 10) : null,
          team: c.group?.name ?? null,
        }))
      : [{ ref: "", title: "No matching changes", status: "", type: "", risk: "", plannedStart: null, team: null }];
  },
});

/* ── Write actions: PROPOSE-only. These never mutate — they are validated and the
      agent must approve them live in the chat before applyTicketProposal runs. ── */

export async function resolveGroupId(name: string) {
  const q = name.trim();
  return db.group.findFirst({ where: { OR: [{ name: q }, { name: { contains: q } }] }, select: { id: true, name: true } });
}
export async function resolveCategoryId(name: string) {
  const q = name.trim();
  // The org directory prints sub-categories as a "Parent > Child" path, so the AI
  // often passes e.g. "Network > VPN" — but a category resolves by its own (leaf)
  // name. Fall back to the last path segment. Prefer an exact match, then contains.
  const leaf = q.split(/\s*[>\/›»]\s*/).pop()?.trim() || q;
  return (
    (await db.category.findFirst({
      where: { OR: [{ name: q }, { name: leaf }] },
      select: { id: true, name: true },
    })) ??
    (await db.category.findFirst({
      where: { name: { contains: leaf } },
      select: { id: true, name: true },
    }))
  );
}
export async function resolveAgentId(name: string) {
  const q = name.trim();
  return db.user.findFirst({
    where: { role: { in: ["ADMIN", "MANAGER", "AGENT"] }, OR: [{ name: { contains: q } }, { email: q }] },
    select: { id: true, name: true },
  });
}

/**
 * Rank candidate names by rough closeness to a query (handles "Parent > Child"
 * paths by matching the leaf): exact > substring > token-overlap. Used to turn a
 * bare "X not found" into an actionable "did you mean …?" so Sable self-corrects.
 */
export function rankSuggestions(names: string[], q: string, n = 3): string[] {
  const query = q.toLowerCase().trim();
  const leaf = query.split(/\s*[>/›»]\s*/).pop()?.trim() || query;
  const qTokens = new Set(leaf.split(/\W+/).filter(Boolean));
  return names
    .map((name) => {
      const l = name.toLowerCase();
      let score = 0;
      if (l === leaf) score = 100;
      else if (l.includes(leaf) || leaf.includes(l)) score = 60;
      else score = 20 * l.split(/\W+/).filter((t) => qTokens.has(t)).length;
      return { name, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((s) => s.name);
}

/** A "did you mean …? / available: …" suffix for a category-not-found error. */
export async function categoryNotFoundHint(q: string): Promise<string> {
  const names = (await db.category.findMany({ select: { name: true } })).map((c) => c.name);
  const sug = rankSuggestions(names, q);
  if (sug.length) return ` Did you mean: ${sug.join(", ")}?`;
  return names.length ? ` Available categories: ${names.slice(0, 12).join(", ")}.` : "";
}

/** A "did you mean …? / available: …" suffix for a team/group-not-found error. */
export async function groupNotFoundHint(q: string): Promise<string> {
  const names = (await db.group.findMany({ select: { name: true } })).map((g) => g.name);
  const sug = rankSuggestions(names, q);
  if (sug.length) return ` Did you mean: ${sug.join(", ")}?`;
  return names.length ? ` Available teams: ${names.slice(0, 12).join(", ")}.` : "";
}
export function parseTicketId(ref: string): number | null {
  const m = String(ref).match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

