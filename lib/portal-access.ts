import { db } from "@/lib/db";

/**
 * Who may see what in the self-service portal. The rules live here once, so a
 * page and its `generateMetadata` (which runs next to the page, not behind it)
 * can never disagree: a title must not reveal a record the page itself would
 * refuse to show.
 */

/** A portal ticket is visible to its requester and to participants (e.g. a CC'd manager). */
export function portalTicketWhere(ticketId: number, userId: string) {
  return {
    id: ticketId,
    OR: [{ requesterId: userId }, { participants: { some: { userId } } }],
  };
}

/** Portal readers only get published, public articles — internal and draft ones are hidden. */
export function isPortalArticle(article: { status: string; visibility: string }): boolean {
  return article.status === "PUBLISHED" && article.visibility === "PUBLIC";
}

/** Only published catalog items can be requested from the portal. */
export function isPortalCatalogItem(item: { isPublished: boolean }): boolean {
  return item.isPublished;
}

/** Title of a ticket for the viewer, or null when they may not see it (or it does not exist). */
export async function portalTicketTitle(rawId: string, userId: string | null): Promise<string | null> {
  const id = Number(rawId);
  if (!userId || !Number.isInteger(id)) return null;
  const ticket = await db.ticket.findFirst({ where: portalTicketWhere(id, userId), select: { title: true } });
  return ticket?.title ?? null;
}

/** Title of an article for portal readers, or null when it is not visible there. */
export async function portalArticleTitle(slug: string): Promise<string | null> {
  const article = await db.article.findUnique({ where: { slug }, select: { title: true, status: true, visibility: true } });
  return article && isPortalArticle(article) ? article.title : null;
}

/** Name of a requestable catalog item, or null when it is unpublished or missing. */
export async function portalCatalogItemName(id: string): Promise<string | null> {
  const item = await db.catalogItem.findUnique({ where: { id }, select: { name: true, isPublished: true } });
  return item && isPortalCatalogItem(item) ? item.name : null;
}
