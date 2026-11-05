import { db } from "@/lib/db";
import {
  CHANGE_STATUS_META,
  PROBLEM_STATUS_META,
  TICKET_STATUS_META,
  type ArticleLinkEntityType,
  type Meta,
} from "@/lib/constants";
import { linkedRecordHref, linkedRecordRef } from "@/lib/article-rules";

const PICKER_LIMIT = 200;

export type LinkedArticle = { linkId: string; slug: string; title: string; status: string };
export type ArticleOption = { value: string; label: string };

/** The articles linked to a record, plus the ones an agent may still attach to it (published, or their own drafts). */
export async function getRelatedArticles(
  entityType: ArticleLinkEntityType,
  entityId: number,
  userId: string,
): Promise<{ linked: LinkedArticle[]; options: ArticleOption[] }> {
  const links = await db.articleLink.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: "asc" },
    select: { id: true, article: { select: { id: true, slug: true, title: true, status: true } } },
  });
  const candidates = await db.article.findMany({
    where: {
      id: { notIn: links.map((l) => l.article.id) },
      OR: [{ status: "PUBLISHED" }, { status: "DRAFT", authorId: userId }],
    },
    orderBy: { title: "asc" },
    take: PICKER_LIMIT,
    select: { id: true, title: true },
  });
  return {
    linked: links.map((l) => ({ linkId: l.id, slug: l.article.slug, title: l.article.title, status: l.article.status })),
    options: candidates.map((a) => ({ value: a.id, label: a.title })),
  };
}

export type LinkedRecord = { key: string; href: string; ref: string; title: string; status: string; statusMeta: Meta };

/** The tickets, problems and changes an article is linked to. Records deleted since are skipped. */
export async function getArticleLinkedRecords(articleId: string): Promise<LinkedRecord[]> {
  const links = await db.articleLink.findMany({ where: { articleId }, orderBy: { createdAt: "asc" }, select: { entityType: true, entityId: true } });
  const idsOf = (type: ArticleLinkEntityType) => links.filter((l) => l.entityType === type).map((l) => l.entityId);
  const [tickets, problems, changes] = await Promise.all([
    db.ticket.findMany({ where: { id: { in: idsOf("TICKET") } }, select: { id: true, prefix: true, title: true, status: true } }),
    db.problem.findMany({ where: { id: { in: idsOf("PROBLEM") } }, select: { id: true, title: true, status: true } }),
    db.change.findMany({ where: { id: { in: idsOf("CHANGE") } }, select: { id: true, title: true, status: true } }),
  ]);
  const record = (
    type: ArticleLinkEntityType,
    r: { id: number; title: string; status: string },
    metaMap: Record<string, Meta>,
    prefix?: string,
  ): LinkedRecord => ({
    key: `${type}-${r.id}`,
    href: linkedRecordHref(type, r.id),
    ref: linkedRecordRef(type, r.id, prefix),
    title: r.title,
    status: r.status,
    statusMeta: metaMap[r.status] ?? { label: r.status, tone: "neutral" },
  });
  return [
    ...tickets.map((t) => record("TICKET", t, TICKET_STATUS_META, t.prefix)),
    ...problems.map((p) => record("PROBLEM", p, PROBLEM_STATUS_META)),
    ...changes.map((c) => record("CHANGE", c, CHANGE_STATUS_META)),
  ];
}
