"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAgentUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { canActOnTicket } from "@/lib/authz";
import { ARTICLE_LINK_ENTITY_TYPES, type ArticleLinkEntityType } from "@/lib/constants";
import { canLinkArticle, linkedRecordHref } from "@/lib/article-rules";
import type { ActionResult } from "@/lib/action-result";

const refused = (error: string): ActionResult => ({ ok: false, error });
const NOT_AUTHORISED = "You are not signed in as an agent.";

type Actor = { id: string; role: string };

function parseTarget(formData: FormData): { entityType: ArticleLinkEntityType; entityId: number } | null {
  const entityType = String(formData.get("entityType") ?? "");
  const entityId = Number(formData.get("entityId"));
  if (!ARTICLE_LINK_ENTITY_TYPES.includes(entityType as ArticleLinkEntityType)) return null;
  if (!Number.isInteger(entityId) || entityId <= 0) return null;
  return { entityType: entityType as ArticleLinkEntityType, entityId };
}

/** Why `actor` may not attach articles to this record, or null when they may (including that it exists). */
async function recordRefusal(entityType: ArticleLinkEntityType, entityId: number, actor: Actor): Promise<string | null> {
  switch (entityType) {
    case "TICKET": {
      const ticket = await db.ticket.findUnique({ where: { id: entityId }, select: { assigneeId: true, groupId: true } });
      if (!ticket) return "Ticket not found.";
      return (await canActOnTicket(actor, ticket))
        ? null
        : "You can't change this ticket — it belongs to a group you're not a member of.";
    }
    case "PROBLEM":
      return (await db.problem.findUnique({ where: { id: entityId }, select: { id: true } })) ? null : "Problem not found.";
    case "CHANGE":
      return (await db.change.findUnique({ where: { id: entityId }, select: { id: true } })) ? null : "Change not found.";
  }
}

const AUDIT_ENTITY: Record<ArticleLinkEntityType, string> = { TICKET: "Ticket", PROBLEM: "Problem", CHANGE: "Change" };

function revalidateLinkPages(slug: string, entityType: ArticleLinkEntityType, entityId: number) {
  revalidatePath(`/knowledge/${slug}`);
  revalidatePath(linkedRecordHref(entityType, entityId));
}

/** Attach a knowledge article to a ticket, problem or change. Idempotent. */
export async function linkArticle(formData: FormData): Promise<ActionResult> {
  const me = await requireAgentUser();
  if (!me) return refused(NOT_AUTHORISED);
  const articleId = String(formData.get("articleId") ?? "").trim();
  const target = parseTarget(formData);
  if (!articleId || !target) return refused("Choose an article.");
  const { entityType, entityId } = target;

  const article = await db.article.findUnique({
    where: { id: articleId },
    select: { id: true, slug: true, title: true, status: true, authorId: true },
  });
  if (!article) return refused("Article not found.");
  if (!canLinkArticle(article, me.id)) return refused("Only published articles, or your own drafts, can be linked.");
  const denied = await recordRefusal(entityType, entityId, me);
  if (denied) return refused(denied);

  await db.articleLink.upsert({
    where: { articleId_entityType_entityId: { articleId, entityType, entityId } },
    create: { articleId, entityType, entityId, createdById: me.id },
    update: {},
  });
  const ref = `${AUDIT_ENTITY[entityType].toLowerCase()} #${entityId}`;
  await writeAudit({ userId: me.id, action: "UPDATE", entity: AUDIT_ENTITY[entityType], entityId, summary: `Linked article "${article.title}"` });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Article", entityId: article.id, summary: `Linked to ${ref}` });
  revalidateLinkPages(article.slug, entityType, entityId);
  return { ok: true };
}

/** Remove an article link by its id. */
export async function unlinkArticle(formData: FormData): Promise<ActionResult> {
  const me = await requireAgentUser();
  if (!me) return refused(NOT_AUTHORISED);
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return refused("Missing link.");

  const link = await db.articleLink.findUnique({
    where: { id },
    select: { id: true, entityType: true, entityId: true, article: { select: { id: true, slug: true, title: true } } },
  });
  // An already-removed link is a benign no-op.
  if (!link) return { ok: true };
  const entityType = link.entityType as ArticleLinkEntityType;

  const denied = await recordRefusal(entityType, link.entityId, me);
  if (denied) return refused(denied);

  await db.articleLink.delete({ where: { id } });
  const ref = `${AUDIT_ENTITY[entityType].toLowerCase()} #${link.entityId}`;
  await writeAudit({ userId: me.id, action: "UPDATE", entity: AUDIT_ENTITY[entityType], entityId: link.entityId, summary: `Unlinked article "${link.article.title}"` });
  await writeAudit({ userId: me.id, action: "UPDATE", entity: "Article", entityId: link.article.id, summary: `Unlinked from ${ref}` });
  revalidateLinkPages(link.article.slug, entityType, link.entityId);
  return { ok: true };
}
