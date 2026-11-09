import { z } from "zod";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { resolveCategoryId } from "@/lib/ai-tools";
import { renderMarkdown } from "@/lib/markdown";
import { slugify } from "@/lib/slug";
import { changeArticleStatus } from "@/lib/actions/knowledge";
import { linkArticle, unlinkArticle } from "@/lib/actions/article-links";
import { ARTICLE_STATUSES, ARTICLE_VISIBILITIES } from "@/lib/constants";
import type { AiOperation } from "../types";
import { ok, err, str, toFormData, coerceEnum, fromActionResult, parseArticleLinkTarget } from "../helpers";

/**
 * Knowledge Base articles. Reference module shape: export `OPERATIONS`, one entry
 * per capability, guarded Prisma writes + writeAudit — except `set_status`, which
 * reuses the app's real non-redirecting action so `published`/`publishedAt` stay
 * in lock-step. Article bodies are stored as sanitised HTML (bodyFormat "html"),
 * so we always run `renderMarkdown` on the incoming body before persisting.
 */


/** Ensure a unique slug by appending "-2", "-3", … (up to 5 tries). */
async function uniqueSlug(base: string): Promise<string> {
  const root = base || "article";
  for (let i = 1; i <= 5; i++) {
    const slug = i === 1 ? root : `${root}-${i}`;
    const existing = await db.article.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
  }
  // Last resort: suffix with a short random token so we never collide.
  return `${root}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Cheap heuristic: does this look like it already contains HTML tags? */
function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(text);
}

type ResolvedArticle = { id: string; title: string; status: string; published: boolean; publishedAt: Date | null };

/**
 * Deterministically resolve a single article for a destructive op. Prefer an
 * explicit `id` or `slug` (both unique); otherwise match the title EXACTLY (never a
 * fuzzy `contains`, which can silently hit the wrong record). If an exact title
 * matches more than one article, we refuse and ask the caller to disambiguate rather
 * than guessing. Returns either the resolved record or an error string to surface.
 */
async function resolveArticle(ref: {
  id?: string;
  slug?: string;
  title?: string;
}): Promise<{ article: ResolvedArticle } | { error: string }> {
  const select = { id: true, title: true, status: true, published: true, publishedAt: true } as const;

  const id = str(ref.id);
  if (id) {
    const article = await db.article.findUnique({ where: { id }, select });
    return article ? { article } : { error: `Article not found: ${id}` };
  }

  const slug = str(ref.slug);
  if (slug) {
    const article = await db.article.findUnique({ where: { slug }, select });
    return article ? { article } : { error: `Article not found: ${slug}` };
  }

  const title = str(ref.title);
  if (!title) return { error: "Provide the article's id, slug, or exact title." };

  // Exact title match only — no fuzzy contains. Fetch up to 2 to detect ambiguity.
  const matches = await db.article.findMany({ where: { title }, select, take: 2 });
  if (matches.length === 0) return { error: `Article not found: ${title}` };
  if (matches.length > 1) {
    return { error: `Multiple articles are titled "${title}". Please specify the article's id or slug to disambiguate.` };
  }
  return { article: matches[0] };
}

const ARTICLE_SELECTOR = {
  id: z.string().optional().describe("the article's id (most precise)"),
  slug: z.string().optional().describe("the article's slug (unique)"),
  title: z.string().optional().describe("the article's EXACT title (must match a single article)"),
};
const RECORD_REF = z.string().describe("ticket, problem or change ref, e.g. 'INC-0042', 'PRB-0019' or 'CHG-0025'");
const UNPARSABLE_RECORD = (ref: unknown) =>
  `Cannot parse a record ref from "${ref}". Use INC-0042, REQ-0042, PRB-0019 or CHG-0025.`;
const articleLabel = (a: Record<string, unknown>) => str(a.title) ?? str(a.slug) ?? str(a.id) ?? "";

export const OPERATIONS: AiOperation[] = [
  {
    id: "article.create",
    group: "Knowledge",
    kind: "write",
    minRole: "AGENT",
    description:
      "Create a Knowledge Base article. The body may be markdown or HTML (it is rendered to sanitised HTML). " +
      "Optionally set an excerpt, a category (by name) and visibility (INTERNAL for agents, PUBLIC for the portal). " +
      "New articles start as a DRAFT — publish them with article.set_status.",
    input: z.object({
      title: z.string().min(3).max(160).describe("article title"),
      body: z.string().describe("article body (markdown or HTML)"),
      excerpt: z.string().max(300).optional().describe("short summary shown in listings"),
      category: z.string().optional().describe("category name"),
      visibility: z.string().optional().describe("INTERNAL (agents) or PUBLIC (portal); defaults to INTERNAL"),
    }),
    label: (a) => `Create article “${str(a.title) ?? ""}”`,
    run: async (a, ctx) => {
      const title = str(a.title);
      if (!title || title.length < 3) return err("Title must be at least 3 characters.");
      if (title.length > 160) return err("Title must be at most 160 characters.");

      const rawBody = str(a.body);
      if (!rawBody) return err("Article body is required.");

      const excerpt = str(a.excerpt);
      if (excerpt && excerpt.length > 300) return err("Excerpt must be at most 300 characters.");

      const visibility = coerceEnum(a.visibility ?? "INTERNAL", ARTICLE_VISIBILITIES);
      if (!visibility) return err(`Invalid visibility. Allowed: ${ARTICLE_VISIBILITIES.join(", ")}.`);

      let categoryId: string | null = null;
      if (str(a.category)) {
        const cat = await resolveCategoryId(String(a.category));
        if (!cat) return err(`Category not found: ${a.category}`);
        categoryId = cat.id;
      }

      // Bodies are persisted as sanitised HTML; render markdown when it isn't already HTML.
      const html = renderMarkdown(rawBody, looksLikeHtml(rawBody) ? "html" : "markdown");
      const slug = await uniqueSlug(slugify(title));

      const article = await db.article.create({
        data: {
          title,
          slug,
          excerpt: excerpt ?? null,
          body: html,
          bodyFormat: "html",
          status: "DRAFT",
          visibility,
          published: false,
          categoryId,
          authorId: ctx.userId,
          revisions: {
            create: { version: 1, title, excerpt: excerpt ?? null, body: html, editorId: ctx.userId, note: "Created" },
          },
        },
        select: { id: true },
      });

      await writeAudit({ userId: ctx.userId, action: "CREATE", entity: "Article", entityId: article.id, summary: `Created article "${title}" via Sable` });
      return ok(`Created article "${title}"`);
    },
  },
  {
    id: "article.set_status",
    group: "Knowledge",
    kind: "write",
    minRole: "AGENT",
    description:
      "Change a Knowledge Base article's status (DRAFT, REVIEW, PUBLISHED, RETIRED). Identify the article by its id or slug, " +
      "or by its EXACT title; if the title is ambiguous the change is refused so you can disambiguate. " +
      "Setting PUBLISHED publishes it (and stamps its first publish time); other statuses unpublish it.",
    input: z.object({
      id: z.string().optional().describe("the article's id (most precise)"),
      slug: z.string().optional().describe("the article's slug (unique)"),
      title: z.string().optional().describe("the article's EXACT title (must match a single article)"),
      status: z.string().describe("DRAFT, REVIEW, PUBLISHED or RETIRED"),
    }),
    label: (a) => `Set article “${str(a.title) ?? str(a.slug) ?? str(a.id) ?? ""}” → ${String(a.status ?? "").toUpperCase()}`,
    run: async (a, _ctx) => {
      const status = coerceEnum(a.status, ARTICLE_STATUSES);
      if (!status) return err(`Invalid status. Allowed: ${ARTICLE_STATUSES.join(", ")}.`);

      const resolved = await resolveArticle({ id: str(a.id), slug: str(a.slug), title: str(a.title) });
      if ("error" in resolved) return err(resolved.error);
      const article = resolved.article;

      // Reuse the real non-redirecting action so published/publishedAt stay in sync + it audits.
      await changeArticleStatus(toFormData({ id: article.id, status }));
      return ok(`Set article "${article.title}" (${article.id}) status to ${status}`);
    },
  },
  {
    id: "article.delete",
    group: "Knowledge",
    kind: "write",
    minRole: "AGENT",
    description:
      "Delete a Knowledge Base article (and its revisions and attachments). Identify it by its id or slug, or by its " +
      "EXACT title; if the title is ambiguous the deletion is refused so you can disambiguate.",
    input: z.object({
      id: z.string().optional().describe("the article's id (most precise)"),
      slug: z.string().optional().describe("the article's slug (unique)"),
      title: z.string().optional().describe("the article's EXACT title (must match a single article)"),
    }),
    label: (a) => `Delete article “${str(a.title) ?? str(a.slug) ?? str(a.id) ?? ""}”`,
    run: async (a, ctx) => {
      const resolved = await resolveArticle({ id: str(a.id), slug: str(a.slug), title: str(a.title) });
      if ("error" in resolved) return err(resolved.error);
      const article = resolved.article;

      try {
        await db.article.delete({ where: { id: article.id } });
      } catch (e) {
        if ((e as { code?: string })?.code === "P2025") return err(`Article not found: ${article.id}`);
        throw e;
      }

      await writeAudit({ userId: ctx.userId, action: "DELETE", entity: "Article", entityId: article.id, summary: `Deleted article "${article.title}" via Sable` });
      return ok(`Deleted article "${article.title}" (${article.id})`);
    },
  },
  {
    id: "article.link",
    group: "Knowledge",
    kind: "write",
    minRole: "AGENT",
    description:
      "Attach a Knowledge Base article to a ticket, problem or change so agents see it on that record. Identify the article by id, slug or EXACT title, " +
      "and the record by its ref (INC-0042, REQ-0042, PRB-0019, CHG-0025). Only published articles, or your own drafts, can be linked. Linking twice is harmless.",
    input: z.object({ ...ARTICLE_SELECTOR, record: RECORD_REF }),
    label: (a) => `Link article “${articleLabel(a)}” → ${a.record}`,
    run: async (a) => {
      const target = parseArticleLinkTarget(a.record);
      if (!target) return err(UNPARSABLE_RECORD(a.record));
      const resolved = await resolveArticle({ id: str(a.id), slug: str(a.slug), title: str(a.title) });
      if ("error" in resolved) return err(resolved.error);
      const { article } = resolved;
      const res = await linkArticle(toFormData({ articleId: article.id, ...target }));
      return fromActionResult(res, `Linked article "${article.title}" to ${String(a.record).trim().toUpperCase()}`);
    },
  },
  {
    id: "article.unlink",
    group: "Knowledge",
    kind: "write",
    minRole: "AGENT",
    description:
      "Remove a Knowledge Base article from a ticket, problem or change it was attached to. Identify the article by id, slug or EXACT title, " +
      "and the record by its ref (INC-0042, REQ-0042, PRB-0019, CHG-0025). The article itself is not deleted.",
    input: z.object({ ...ARTICLE_SELECTOR, record: RECORD_REF }),
    label: (a) => `Unlink article “${articleLabel(a)}” from ${a.record}`,
    run: async (a) => {
      const target = parseArticleLinkTarget(a.record);
      if (!target) return err(UNPARSABLE_RECORD(a.record));
      const resolved = await resolveArticle({ id: str(a.id), slug: str(a.slug), title: str(a.title) });
      if ("error" in resolved) return err(resolved.error);
      const { article } = resolved;
      const record = String(a.record).trim().toUpperCase();
      const link = await db.articleLink.findUnique({
        where: { articleId_entityType_entityId: { articleId: article.id, ...target } },
        select: { id: true },
      });
      if (!link) return err(`Article "${article.title}" is not linked to ${record}.`);
      const res = await unlinkArticle(toFormData({ id: link.id }));
      return fromActionResult(res, `Unlinked article "${article.title}" from ${record}`);
    },
  },
];
