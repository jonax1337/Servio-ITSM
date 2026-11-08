import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiError, ok, pageMeta, paginate, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { insertArticle, isUniqueViolation } from "@/lib/articles";
import { articleBodyHtml, articleCreateSchema } from "@/lib/api-article-input";
import { agentGuard, readBody } from "../_itsm";
import { ARTICLE_SELECT, categoryError, emptyBodyError, serializeArticle } from "../_articles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * Knowledge articles, newest change first (paginated, without bodies). Filters:
 * `status`, `visibility`, `category_id`, `import_ref`, `updated_since` (ISO
 * time) and `q` (title or excerpt).
 */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "read");
  if ("response" in auth) return auth.response;
  const p = new URL(req.url).searchParams;
  const { page, perPage, skip, take } = paginate(p);
  const where: Prisma.ArticleWhereInput = {};
  if (p.get("status")) where.status = p.get("status")!;
  if (p.get("visibility")) where.visibility = p.get("visibility")!;
  if (p.get("category_id")) where.categoryId = p.get("category_id")!;
  if (p.get("import_ref")) where.importRef = p.get("import_ref")!;
  const since = p.get("updated_since");
  if (since) {
    const d = new Date(since);
    if (Number.isNaN(d.getTime())) return apiError(422, "Validation failed", { updated_since: ["Must be an ISO date/time"] });
    where.updatedAt = { gte: d };
  }
  const q = p.get("q")?.trim();
  if (q) where.OR = [{ title: { contains: q } }, { excerpt: { contains: q } }];

  const [total, rows] = await Promise.all([
    db.article.count({ where }),
    db.article.findMany({ where, select: ARTICLE_SELECT, orderBy: { updatedAt: "desc" }, skip, take }),
  ]);
  return ok(rows.map((a) => serializeArticle(a, { withBody: false })), { meta: pageMeta(page, perPage, total) });
}

/** Create an article as a DRAFT authored by the token's owner (publishing goes through the review: POST /articles/{id}/transitions). */
export async function POST(req: Request) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const parsed = await readBody(req, articleCreateSchema);
  if ("response" in parsed) return parsed.response;
  const b = parsed.data;
  const invalidCategory = await categoryError(b.category_id);
  if (invalidCategory) return invalidCategory;
  const body = articleBodyHtml(b.body, b.body_format);
  if (!body) return emptyBodyError();
  if (b.import_ref) {
    const taken = await db.article.findUnique({ where: { importRef: b.import_ref }, select: { id: true } });
    if (taken) return apiError(409, "An article with this import_ref already exists; update it with PUT /articles/ref/{ref}.", { id: taken.id });
  }

  const me = auth.principal.userId;
  let created: { id: string } | null;
  try {
    created = await insertArticle(
      {
        title: b.title,
        excerpt: b.excerpt || null,
        body,
        bodyFormat: "html",
        status: "DRAFT",
        visibility: b.visibility ?? "INTERNAL",
        published: false,
        categoryId: b.category_id ?? null,
        authorId: me,
        importRef: b.import_ref ?? null,
      },
      me,
    );
  } catch (err) {
    if (isUniqueViolation(err)) return apiError(409, "An article with this import_ref already exists; update it with PUT /articles/ref/{ref}.");
    throw err;
  }
  if (!created) return apiError(409, "Could not find a free slug for this title; retry.");
  await writeAudit({ userId: me, action: "CREATE", entity: "Article", entityId: created.id, summary: `Created article "${b.title}" via API` });
  const article = await db.article.findUniqueOrThrow({ where: { id: created.id }, select: ARTICLE_SELECT });
  return ok(serializeArticle(article), { status: 201 });
}
