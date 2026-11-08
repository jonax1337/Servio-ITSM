import { z } from "zod";
import { ARTICLE_STATUSES, ARTICLE_VISIBILITIES } from "@/lib/constants";
import { externalRefSchema } from "@/lib/ticket-external-ref";
import { htmlToText, renderMarkdown, sanitizeCommentHtml } from "@/lib/markdown";

/**
 * Request bodies of the /api/v1/articles endpoints (snake_case, strict) and the
 * pure helpers the handlers share. Shared with the OpenAPI route.
 */

export const ARTICLE_BODY_FORMATS = ["markdown", "html"] as const;

const id = z.string().min(1);
const content = {
  title: z.string().trim().min(3, "Title must be at least 3 characters").max(160),
  /** Markdown (default) or HTML; stored as sanitised HTML like articles written in the console. */
  body: z.string().min(1).max(200_000),
  body_format: z.enum(ARTICLE_BODY_FORMATS).optional(),
  excerpt: z.string().trim().max(300).nullable().optional(),
  visibility: z.enum(ARTICLE_VISIBILITIES).optional(),
  category_id: id.nullable().optional(),
};

export const articleCreateSchema = z.strictObject({
  ...content,
  /** Origin key for a script-maintained article; PUT /articles/ref/{ref} upserts by it. */
  import_ref: externalRefSchema.optional(),
});

export const articlePatchSchema = z
  .strictObject({ ...content, title: content.title.optional(), body: content.body.optional() })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" })
  .refine((b) => b.body_format === undefined || b.body !== undefined, { message: "body_format needs a body", path: ["body_format"] });

/** PUT /articles/ref/{ref}: the article's full desired state. `status` needs an admin token (it skips the review). */
export const articleUpsertSchema = z.strictObject({ ...content, status: z.enum(ARTICLE_STATUSES).optional() });

export const articleTransitionSchema = z.strictObject({ to: z.enum(ARTICLE_STATUSES) });

export type ArticleCreate = z.infer<typeof articleCreateSchema>;
export type ArticlePatch = z.infer<typeof articlePatchSchema>;
export type ArticleUpsert = z.infer<typeof articleUpsertSchema>;

/** The stored (sanitised HTML) form of a body, or null when nothing readable is left after sanitising. */
export function articleBodyHtml(body: string, format: (typeof ARTICLE_BODY_FORMATS)[number] = "markdown"): string | null {
  const html = format === "html" ? sanitizeCommentHtml(body) : renderMarkdown(body, "markdown");
  return htmlToText(html).trim() ? html : null;
}

export type ArticleFields = {
  title: string;
  excerpt: string | null;
  body: string;
  visibility: string;
  categoryId: string | null;
  status: string;
};

/** The fields of `next` that differ from `current` (an unchanged upsert writes nothing). */
export function changedArticleFields(current: ArticleFields, next: Partial<ArticleFields>): (keyof ArticleFields)[] {
  return (Object.keys(next) as (keyof ArticleFields)[]).filter((k) => next[k] !== undefined && next[k] !== current[k]);
}

/** Status columns for a status set directly (upsert): `published` mirrors PUBLISHED; publishing stamps the approval. */
export function statusColumns(status: string, current: { publishedAt: Date | null }, actorId: string, now = new Date()) {
  const publishing = status === "PUBLISHED";
  return {
    status,
    published: publishing,
    ...(publishing && { publishedAt: current.publishedAt ?? now, approvedById: actorId, approvedAt: now }),
  };
}
