import { db } from "@/lib/db";
import { apiError, ok, preflight, requireScope, type ApiPrincipal } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { hasRole, type Role } from "@/lib/session";
import { statusAfterEdit } from "@/lib/article-rules";
import { insertArticle, isUniqueViolation, reviseArticle } from "@/lib/articles";
import { articleBodyHtml, articleUpsertSchema, changedArticleFields, statusColumns, type ArticleFields, type ArticleUpsert } from "@/lib/api-article-input";
import { EXTERNAL_REF_HINT, EXTERNAL_REF_RE } from "@/lib/ticket-external-ref";
import { agentGuard, readBody } from "../../../_itsm";
import { ARTICLE_SELECT, categoryError, emptyBodyError, serializeArticle } from "../../../_articles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

async function refOf(ctx: { params: Promise<{ ref: string }> }) {
  const ref = decodeURIComponent((await ctx.params).ref);
  return EXTERNAL_REF_RE.test(ref) ? ref : null;
}

/** The article with this origin reference (e.g. `faq:vpn-setup`), or 404. */
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "read");
  if ("response" in auth) return auth.response;
  const ref = await refOf(ctx);
  const article = ref ? await db.article.findUnique({ where: { importRef: ref }, select: ARTICLE_SELECT }) : null;
  if (!article) return apiError(404, "Article not found");
  return ok(serializeArticle(article));
}

/**
 * Upsert by origin reference, for keeping a set of articles (an FAQ) in step
 * with a source. Creates the article (201) when the reference is new, otherwise
 * writes the fields that differ as a new revision (200). Re-sending the same
 * content writes nothing; `meta.changed` lists what changed.
 *
 * Setting `status` skips the review (it publishes directly), so it needs the
 * `admin` scope and an ADMIN token owner, like the history import. Without
 * `status`, a new article is a DRAFT and an existing one keeps its status,
 * except that a published article changed by a token below MANAGER goes back
 * to review, as in the console.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const ref = await refOf(ctx);
  if (!ref) return apiError(422, "Validation failed", { ref: [EXTERNAL_REF_HINT] });
  const parsed = await readBody(req, articleUpsertSchema);
  if ("response" in parsed) return parsed.response;
  const b = parsed.data;
  if (b.status && !(requireScope(auth.principal, "admin") && auth.principal.role === "ADMIN")) {
    return apiError(403, "Setting status skips the review; it needs the admin scope and a token owned by an ADMIN.");
  }
  const invalidCategory = await categoryError(b.category_id);
  if (invalidCategory) return invalidCategory;
  const body = articleBodyHtml(b.body, b.body_format);
  if (!body) return emptyBodyError();

  try {
    return await upsert(auth.principal, ref, b, body);
  } catch (err) {
    // Two runs creating the same ref at once: the loser retries as an update.
    if (isUniqueViolation(err)) return upsert(auth.principal, ref, b, body);
    throw err;
  }
}

async function upsert(principal: ApiPrincipal, ref: string, b: ArticleUpsert, body: string) {
  const me = principal.userId;
  const existing = await db.article.findUnique({ where: { importRef: ref }, select: ARTICLE_SELECT });
  const next: Partial<ArticleFields> & { title: string; body: string } = {
    title: b.title,
    body,
    ...(b.excerpt !== undefined && { excerpt: b.excerpt || null }),
    ...(b.visibility && { visibility: b.visibility }),
    ...(b.category_id !== undefined && { categoryId: b.category_id }),
  };
  if (b.status) next.status = b.status;

  if (!existing) {
    const status = b.status ?? "DRAFT";
    const created = await insertArticle(
      {
        title: b.title,
        excerpt: b.excerpt || null,
        body,
        bodyFormat: "html",
        visibility: b.visibility ?? "INTERNAL",
        categoryId: b.category_id ?? null,
        authorId: me,
        importRef: ref,
        ...statusColumns(status, { publishedAt: null }, me),
      },
      me,
    );
    if (!created) return apiError(409, "Could not find a free slug for this title; retry.");
    await writeAudit({ userId: me, action: "CREATE", entity: "Article", entityId: created.id, summary: `Created article "${b.title}" via API (${ref})` });
    const article = await db.article.findUniqueOrThrow({ where: { id: created.id }, select: ARTICLE_SELECT });
    return ok(serializeArticle(article), { status: 201, meta: { created: true, changed: Object.keys(next) } });
  }

  const changed = changedArticleFields(existing, next);
  if (changed.length > 0 && !b.status) {
    const status = statusAfterEdit(existing.status, hasRole(principal.role as Role, "MANAGER"));
    if (status !== existing.status) {
      next.status = status;
      changed.push("status");
    }
  }
  if (changed.length > 0) {
    const saved = await reviseArticle(
      existing.id,
      {
        title: next.title,
        excerpt: next.excerpt === undefined ? existing.excerpt : next.excerpt,
        body,
        bodyFormat: "html",
        ...(next.visibility && { visibility: next.visibility }),
        ...(next.categoryId !== undefined && { categoryId: next.categoryId }),
        ...(changed.includes("status") && statusColumns(next.status!, existing, me)),
      },
      me,
      `Updated via API (${ref})`,
    );
    if (!saved) return apiError(409, "Save conflicted with a concurrent edit, please retry.");
    await writeAudit({ userId: me, action: "UPDATE", entity: "Article", entityId: existing.id, summary: `Updated article "${next.title}" via API (${ref}: ${changed.join(", ")})` });
  }
  const article = await db.article.findUniqueOrThrow({ where: { id: existing.id }, select: ARTICLE_SELECT });
  return ok(serializeArticle(article), { meta: { created: false, changed } });
}
