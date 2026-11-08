import { db } from "@/lib/db";
import { apiError } from "@/lib/api";

/** Shared plumbing of the /articles endpoints. */

export const ARTICLE_SELECT = {
  id: true, slug: true, title: true, excerpt: true, body: true, bodyFormat: true, status: true, visibility: true,
  categoryId: true, authorId: true, approvedById: true, importRef: true, views: true,
  publishedAt: true, approvedAt: true, createdAt: true, updatedAt: true,
} as const;

type ArticleRow = {
  id: string; slug: string; title: string; excerpt: string | null; body: string; bodyFormat: string; status: string;
  visibility: string; categoryId: string | null; authorId: string | null; approvedById: string | null;
  importRef: string | null; views: number; publishedAt: Date | null; approvedAt: Date | null; createdAt: Date; updatedAt: Date;
};

/** An article as the API returns it; lists leave out the body. */
export function serializeArticle(a: ArticleRow, { withBody = true } = {}) {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    excerpt: a.excerpt,
    ...(withBody && { body: a.body, body_format: a.bodyFormat }),
    status: a.status,
    visibility: a.visibility,
    category_id: a.categoryId,
    author_id: a.authorId,
    approved_by_id: a.approvedById,
    import_ref: a.importRef,
    views: a.views,
    published_at: a.publishedAt?.toISOString() ?? null,
    approved_at: a.approvedAt?.toISOString() ?? null,
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
  };
}

/** 422 for a category id that does not exist. */
export async function categoryError(categoryId: string | null | undefined) {
  if (!categoryId || (await db.category.findUnique({ where: { id: categoryId }, select: { id: true } }))) return null;
  return apiError(422, "Validation failed", { category_id: [`Unknown category: ${categoryId}`] });
}

export function emptyBodyError() {
  return apiError(422, "Validation failed", { body: ["Article body cannot be empty"] });
}
