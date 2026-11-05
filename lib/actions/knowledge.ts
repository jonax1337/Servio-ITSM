"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { sanitizeCommentHtml, htmlToText } from "@/lib/markdown";
import { getCurrentUser, hasRole, type Role, requireAgentUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { ARTICLE_STATUSES, ARTICLE_VISIBILITIES } from "@/lib/constants";

export type ArticleState = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
} | undefined;

const articleSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(160),
  excerpt: z.string().max(300).optional().default(""),
  categoryId: z.string().optional().default(""),
  visibility: z.enum(ARTICLE_VISIBILITIES).default("INTERNAL"),
});

async function requireAgent() {
  // DB-truth guard (role + isActive rehydrated) — see requireAgentUser.
  return requireAgentUser();
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "article"
  );
}

async function uniqueSlug(base: string, excludeId?: string) {
  let slug = base;
  let n = 1;
  // Loop until we find a free slug (or the collision is the article itself).
  while (true) {
    const existing = await db.article.findUnique({ where: { slug }, select: { id: true } });
    if (!existing || existing.id === excludeId) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

type ParsedArticle =
  | { success: true; data: z.infer<typeof articleSchema>; body: string }
  | { success: false; fieldErrors: Record<string, string[]> };

function parse(formData: FormData): ParsedArticle {
  const raw = {
    title: String(formData.get("title") ?? ""),
    excerpt: String(formData.get("excerpt") ?? ""),
    categoryId: String(formData.get("categoryId") ?? ""),
    visibility: String(formData.get("visibility") ?? "INTERNAL"),
  };
  const parsed = articleSchema.safeParse(raw);

  // Body arrives as rich HTML; sanitize it and validate on the derived plaintext.
  const body = sanitizeCommentHtml(String(formData.get("bodyHtml") ?? ""));
  const bodyEmpty = htmlToText(body).trim() === "";

  if (!parsed.success || bodyEmpty) {
    const fieldErrors: Record<string, string[]> = parsed.success
      ? {}
      : parsed.error.flatten().fieldErrors;
    if (bodyEmpty) fieldErrors.body = ["Article body cannot be empty"];
    return { success: false, fieldErrors };
  }
  return { success: true, data: parsed.data, body };
}

const cleanCategory = (v: string) => (v && v !== "none" ? v : null);

/** Prisma unique-constraint violation (e.g. slug or (articleId, version)). */
function isUniqueSablelation(e: unknown) {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

export async function createArticle(_prev: ArticleState, formData: FormData): Promise<ArticleState> {
  const me = await requireAgent();
  if (!me) return { error: "You need agent access to author articles." };

  const parsed = parse(formData);
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.fieldErrors };
  }
  const { title, excerpt, categoryId, visibility } = parsed.data;
  const body = parsed.body;
  const base = slugify(title);

  // Retry on the rare slug collision (concurrent create with the same title).
  let article: { id: string; slug: string } | null = null;
  for (let attempt = 0; attempt < 5 && !article; attempt++) {
    const slug = await uniqueSlug(base);
    try {
      article = await db.article.create({
        data: {
          title,
          slug,
          excerpt: excerpt || null,
          body,
          bodyFormat: "html",
          status: "DRAFT",
          visibility,
          published: false,
          categoryId: cleanCategory(categoryId),
          authorId: me.id,
          revisions: {
            create: { version: 1, title, excerpt: excerpt || null, body, editorId: me.id, note: "Created" },
          },
        },
        select: { id: true, slug: true },
      });
    } catch (e) {
      if (isUniqueSablelation(e)) continue;
      throw e;
    }
  }
  if (!article) return { error: "Could not save the article, please try again." };

  await writeAudit({ userId: me.id, action: "CREATE", entity: "Article", entityId: article.id, summary: `Created article "${title}"` });
  revalidatePath("/knowledge");
  redirect(`/knowledge/${article.slug}`);
}

export async function updateArticle(_prev: ArticleState, formData: FormData): Promise<ArticleState> {
  const me = await requireAgent();
  if (!me) return { error: "You need agent access to edit articles." };

  const id = String(formData.get("id") ?? "");
  const article = await db.article.findUnique({ where: { id }, select: { id: true, slug: true } });
  if (!article) return { error: "Article not found." };

  const parsed = parse(formData);
  if (!parsed.success) {
    return { error: "Please fix the errors below.", fieldErrors: parsed.fieldErrors };
  }
  const { title, excerpt, categoryId, visibility } = parsed.data;
  const body = parsed.body;

  // Recompute the next revision number each attempt; retry if a concurrent edit
  // grabbed the same version (violates @@unique([articleId, version])).
  let saved = false;
  for (let attempt = 0; attempt < 5 && !saved; attempt++) {
    const revisionCount = await db.articleRevision.count({ where: { articleId: id } });
    try {
      await db.article.update({
        where: { id },
        data: {
          title,
          excerpt: excerpt || null,
          body,
          bodyFormat: "html",
          visibility,
          categoryId: cleanCategory(categoryId),
          revisions: {
            create: {
              version: revisionCount + 1,
              title,
              excerpt: excerpt || null,
              body,
              editorId: me.id,
              note: "Edited",
            },
          },
        },
      });
      saved = true;
    } catch (e) {
      if (isUniqueSablelation(e)) continue;
      throw e;
    }
  }
  if (!saved) return { error: "Save conflicted with a concurrent edit, please retry." };

  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Article", entityId: id, summary: `Edited article "${title}"` });
  revalidatePath("/knowledge");
  revalidatePath(`/knowledge/${article.slug}`);
  revalidatePath(`/portal/knowledge/${article.slug}`);
  redirect(`/knowledge/${article.slug}`);
}

export async function changeArticleStatus(formData: FormData) {
  const me = await requireAgent();
  if (!me) throw new Error("You need agent access to change an article's status.");

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!ARTICLE_STATUSES.includes(status as (typeof ARTICLE_STATUSES)[number])) {
    throw new Error("Unknown article status.");
  }

  const article = await db.article.findUnique({ where: { id } });
  if (!article) throw new Error("Article not found.");

  const publishing = status === "PUBLISHED";

  // Publishing pushes the article to the (potentially public) portal, so it is
  // an editorial approval — not a self-service action. Require a DISTINCT
  // reviewer with MANAGER+ and re-check the role against the CURRENT DB user
  // (never the stale JWT). Record who approved and when.
  if (publishing) {
    const row = await getCurrentUser();
    if (!row || !row.isActive || !hasRole(row.role as Role, "MANAGER")) {
      throw new Error("Publishing an article requires manager approval.");
    }
    if (article.authorId && article.authorId === row.id) {
      throw new Error("An article must be published by a different reviewer than its author.");
    }
  }

  await db.article.update({
    where: { id },
    data: {
      status,
      published: publishing, // keep the denormalized mirror in lock-step
      // stamp first publish time; keep it once set
      publishedAt: publishing && !article.publishedAt ? new Date() : article.publishedAt,
      // record the reviewer who approved this publish
      approvedById: publishing ? me.id : article.approvedById,
      approvedAt: publishing ? new Date() : article.approvedAt,
    },
  });

  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Article", entityId: id, summary: `Article status → ${status}` });
  revalidatePath("/knowledge");
  revalidatePath(`/knowledge/${article.slug}`);
  revalidatePath("/portal/knowledge");
  revalidatePath(`/portal/knowledge/${article.slug}`);
}

/**
 * Restore an article's title/excerpt/body from one of its past revisions.
 * Non-destructive: writes a NEW revision carrying the old content forward
 * (append-only history, nothing is deleted or rewritten in place).
 */
export async function restoreArticleRevision(formData: FormData) {
  const me = await requireAgent();
  if (!me) throw new Error("You need agent access to restore a revision.");

  const articleId = String(formData.get("articleId") ?? "");
  const revisionId = String(formData.get("revisionId") ?? "");

  const article = await db.article.findUnique({ where: { id: articleId }, select: { id: true, slug: true } });
  if (!article) throw new Error("Article not found.");

  const revision = await db.articleRevision.findUnique({ where: { id: revisionId } });
  if (!revision || revision.articleId !== articleId) throw new Error("Revision not found.");

  // Same revision-number race handling as updateArticle above.
  let saved = false;
  for (let attempt = 0; attempt < 5 && !saved; attempt++) {
    const revisionCount = await db.articleRevision.count({ where: { articleId } });
    try {
      await db.article.update({
        where: { id: articleId },
        data: {
          title: revision.title,
          excerpt: revision.excerpt,
          body: revision.body,
          bodyFormat: "html",
          revisions: {
            create: {
              version: revisionCount + 1,
              title: revision.title,
              excerpt: revision.excerpt,
              body: revision.body,
              editorId: me.id,
              note: `Restored from v${revision.version}`,
            },
          },
        },
      });
      saved = true;
    } catch (e) {
      if (isUniqueSablelation(e)) continue;
      throw e;
    }
  }
  if (!saved) throw new Error("Restore conflicted with a concurrent edit, please retry.");

  await writeAudit({
    userId: me.id,
    action: "UPDATE",
    entity: "Article",
    entityId: articleId,
    summary: `Restored article "${revision.title}" to v${revision.version}`,
  });
  revalidatePath("/knowledge");
  revalidatePath(`/knowledge/${article.slug}`);
  revalidatePath(`/portal/knowledge/${article.slug}`);
}

export async function deleteArticle(formData: FormData) {
  const me = await requireAgent();
  if (!me) throw new Error("You need agent access to delete articles.");
  const id = String(formData.get("id") ?? "");
  const article = await db.article.findUnique({ where: { id }, select: { title: true } });
  if (!article) throw new Error("Article not found.");
  // Let a delete failure surface (like deleteAsset/deleteGroup) instead of
  // silently swallowing it and pretending the article was removed.
  await db.article.delete({ where: { id } });
  await writeAudit({ userId: me.id, action: "DELETE", entity: "Article", entityId: id, summary: `Deleted article "${article.title}"` });
  revalidatePath("/knowledge");
  redirect("/knowledge");
}
