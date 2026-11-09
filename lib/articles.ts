import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { notify } from "@/lib/audit";
import { slugify } from "@/lib/slug";

/**
 * Article writes shared by the console actions (lib/actions/knowledge.ts) and
 * the REST API (app/api/v1/articles): unique slugs and the append-only
 * revision history. Server-only, no authorization — callers check that first.
 */

/** Concurrent writers that keep colliding on the slug or the revision number are given up on after this many tries. */
const WRITE_ATTEMPTS = 5;

export { slugify };

async function uniqueSlug(base: string) {
  let slug = base;
  let n = 1;
  while (await db.article.findUnique({ where: { slug }, select: { id: true } })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

/** Prisma unique-constraint violation (slug, importRef or (articleId, version)). */
export function isUniqueViolation(e: unknown) {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

type NewArticle = Omit<Prisma.ArticleUncheckedCreateInput, "slug" | "revisions"> & { title: string; body: string; excerpt?: string | null };

/**
 * Insert an article with a free slug from its title and revision 1. Retries
 * when a concurrent create takes the same slug; null when it kept losing.
 */
export async function insertArticle(data: NewArticle, editorId: string): Promise<{ id: string; slug: string } | null> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const slug = await uniqueSlug(slugify(data.title));
    try {
      return await db.article.create({
        data: {
          ...data,
          slug,
          revisions: { create: { version: 1, title: data.title, excerpt: data.excerpt ?? null, body: data.body, editorId, note: "Created" } },
        },
        select: { id: true, slug: true },
      });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      // A unique clash that is not the slug (e.g. importRef) will not go away on a retry.
      if (!(await db.article.findUnique({ where: { slug }, select: { id: true } }))) throw e;
    }
  }
  return null;
}

type ArticleRevisionUpdate = Prisma.ArticleUncheckedUpdateInput & { title: string; body: string; excerpt: string | null };

/**
 * Write new content to an article together with the next revision. Retries when
 * a concurrent edit takes the same revision number; false when it kept losing.
 */
export async function reviseArticle(id: string, data: ArticleRevisionUpdate, editorId: string, note: string): Promise<boolean> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const revisionCount = await db.articleRevision.count({ where: { articleId: id } });
    try {
      await db.article.update({
        where: { id },
        data: {
          ...data,
          revisions: {
            create: { version: revisionCount + 1, title: data.title, excerpt: data.excerpt, body: data.body, editorId, note },
          },
        },
      });
      return true;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  return false;
}

/** Tell the managers (except `actorId`) that an article is waiting for their review. */
export async function notifyReviewers(article: { id: string; title: string }, actorId: string) {
  const managers = await db.user.findMany({
    where: { role: { in: ["MANAGER", "ADMIN"] }, isActive: true, id: { not: actorId } },
    select: { id: true },
  });
  await Promise.all(
    managers.map((m) =>
      notify(m.id, {
        type: "INFO",
        title: "Article awaiting review",
        body: article.title,
        entity: "Article",
        entityId: article.id,
      }),
    ),
  );
}
