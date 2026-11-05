import { problemRef, changeRef, ticketRef, type ArticleLinkEntityType } from "@/lib/constants";

/** Allowed article status moves; the article page offers exactly these buttons. */
export const ARTICLE_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ["REVIEW", "PUBLISHED"],
  REVIEW: ["DRAFT", "PUBLISHED"],
  PUBLISHED: ["DRAFT", "RETIRED"],
  RETIRED: ["DRAFT", "REVIEW", "PUBLISHED"],
};

export function canMoveArticle(from: string, to: string): boolean {
  return ARTICLE_TRANSITIONS[from]?.includes(to) ?? false;
}

export const FOUR_EYES_EDIT_HINT =
  "This article is published. Saving your changes sends it back to review until a manager approves it again.";

/**
 * Status an article has after its content was edited. A published article stays
 * published when a manager edits it; below MANAGER the edit needs a second pair
 * of eyes, so it goes back to REVIEW.
 */
export function statusAfterEdit(status: string, editorIsManager: boolean): string {
  return status === "PUBLISHED" && !editorIsManager ? "REVIEW" : status;
}

/** Whether an article can be attached to a ticket, problem or change: published, or the user's own draft. */
export function canLinkArticle(article: { status: string; authorId: string | null }, userId: string): boolean {
  return article.status === "PUBLISHED" || (article.status === "DRAFT" && article.authorId === userId);
}

const LINKED_RECORD_BASE: Record<ArticleLinkEntityType, string> = {
  TICKET: "/tickets",
  PROBLEM: "/problems",
  CHANGE: "/changes",
};

export function linkedRecordHref(entityType: ArticleLinkEntityType, entityId: number): string {
  return `${LINKED_RECORD_BASE[entityType]}/${entityId}`;
}

export function linkedRecordRef(entityType: ArticleLinkEntityType, entityId: number, ticketPrefix?: string): string {
  if (entityType === "TICKET") return ticketRef(entityId, ticketPrefix);
  return entityType === "PROBLEM" ? problemRef(entityId) : changeRef(entityId);
}
