import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { hasRole, type Role } from "@/lib/session";
import { statusAfterEdit } from "@/lib/article-rules";
import { notifyReviewers, reviseArticle } from "@/lib/articles";
import { articleBodyHtml, articlePatchSchema } from "@/lib/api-article-input";
import { agentGuard, readBody } from "../../_itsm";
import { ARTICLE_SELECT, categoryError, emptyBodyError, serializeArticle } from "../../_articles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "kb:read");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const article = await db.article.findUnique({ where: { id }, select: ARTICLE_SELECT });
  if (!article) return apiError(404, "Article not found");
  return ok(serializeArticle(article));
}

/**
 * Edit an article's content (only the fields sent), as the console's editor does:
 * every edit is a new revision, and a published article edited by a token below
 * MANAGER goes back to review.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "kb:write");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const current = await db.article.findUnique({ where: { id }, select: { id: true, title: true, excerpt: true, body: true, status: true } });
  if (!current) return apiError(404, "Article not found");
  const parsed = await readBody(req, articlePatchSchema);
  if ("response" in parsed) return parsed.response;
  const b = parsed.data;
  const invalidCategory = await categoryError(b.category_id);
  if (invalidCategory) return invalidCategory;
  const body = b.body === undefined ? current.body : articleBodyHtml(b.body, b.body_format);
  if (!body) return emptyBodyError();

  const nextStatus = statusAfterEdit(current.status, hasRole(auth.principal.role as Role, "MANAGER"));
  const sentBackToReview = nextStatus !== current.status;
  const title = b.title ?? current.title;
  const saved = await reviseArticle(
    id,
    {
      title,
      excerpt: b.excerpt === undefined ? current.excerpt : b.excerpt || null,
      body,
      bodyFormat: "html",
      ...(b.visibility && { visibility: b.visibility }),
      ...(b.category_id !== undefined && { categoryId: b.category_id }),
      ...(sentBackToReview && { status: nextStatus, published: false }),
    },
    auth.principal.userId,
    sentBackToReview ? "Edited via API (sent back to review)" : "Edited via API",
  );
  if (!saved) return apiError(409, "Save conflicted with a concurrent edit, please retry.");
  await writeAudit({
    userId: auth.principal.userId, action: "UPDATE", entity: "Article", entityId: id,
    summary: sentBackToReview ? `Edited published article "${title}" via API → sent back to review` : `Edited article "${title}" via API`,
  });
  if (sentBackToReview) await notifyReviewers({ id, title }, auth.principal.userId);
  const article = await db.article.findUniqueOrThrow({ where: { id }, select: ARTICLE_SELECT });
  return ok(serializeArticle(article));
}

/** Delete an article with its revisions and links (any agent, as in the console). */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "kb:write");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const article = await db.article.findUnique({ where: { id }, select: { title: true } });
  if (!article) return apiError(404, "Article not found");
  await db.article.delete({ where: { id } });
  await writeAudit({ userId: auth.principal.userId, action: "DELETE", entity: "Article", entityId: id, summary: `Deleted article "${article.title}" via API` });
  return ok({ id, deleted: true });
}
