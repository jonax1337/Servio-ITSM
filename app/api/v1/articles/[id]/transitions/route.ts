import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { setArticleStatus } from "@/lib/actions/knowledge";
import { articleTransitionSchema } from "@/lib/api-article-input";
import { formOf } from "@/lib/api-itsm-input";
import { agentGuard, asActor, readBody, refusal } from "../../../_itsm";
import { ARTICLE_SELECT, serializeArticle } from "../../../_articles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * Move an article along its lifecycle through the console's action, so the same
 * rules apply: publishing needs a MANAGER+ token owner who is not the author.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "kb:write");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  if (!(await db.article.findUnique({ where: { id }, select: { id: true } }))) return apiError(404, "Article not found");
  const parsed = await readBody(req, articleTransitionSchema);
  if ("response" in parsed) return parsed.response;

  const result = await asActor(auth.principal, () => setArticleStatus(formOf({ id, status: parsed.data.to })));
  if (!result.ok) return refusal(result.error ?? "The status change was refused.");
  const article = await db.article.findUniqueOrThrow({ where: { id }, select: ARTICLE_SELECT });
  return ok(serializeArticle(article));
}
