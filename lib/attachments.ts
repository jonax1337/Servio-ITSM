import { db } from "@/lib/db";
import { isAgent, type Role } from "@/lib/session";
import { loadAccessibleProject } from "@/lib/ai-projects";

export type SessionActor = { id: string; role: Role };

export type UploadTarget =
  | { kind: "ticket"; ticketId: number }
  | { kind: "comment"; commentId: string }
  | { kind: "article"; articleId: string }
  | { kind: "aiProject"; projectId: string; folderId?: string | null };

/**
 * The FK columns to persist on the created Attachment row. Ticket/comment/article
 * targets set their column; an aiProject upload carries NO Attachment FK (the join
 * lives on AiProjectFile.attachmentId @unique), so it resolves to an empty object —
 * a non-null "allowed, no FK" signal distinct from `null` (deny/not-found).
 */
type ForeignKey = { ticketId?: number; commentId?: string; articleId?: string };

/**
 * Authorize an upload to a target and return the FK columns to persist, or null
 * on deny OR not-found (the caller maps both to 404 — no existence oracle).
 */
export async function canUploadTo(actor: SessionActor, target: UploadTarget): Promise<ForeignKey | null> {
  const agent = isAgent(actor.role);

  if (target.kind === "ticket") {
    const t = await db.ticket.findUnique({ where: { id: target.ticketId }, select: { requesterId: true, status: true } });
    if (!t) return null;
    if (t.status === "CLOSED" || t.status === "CANCELLED") return null;
    if (agent || t.requesterId === actor.id) return { ticketId: target.ticketId };
    return null;
  }

  if (target.kind === "comment") {
    const c = await db.ticketComment.findUnique({
      where: { id: target.commentId },
      select: { isInternal: true, authorId: true, ticket: { select: { requesterId: true, status: true } } },
    });
    if (!c) return null;
    if (agent) return { commentId: target.commentId };
    // Requesters may only add files to their OWN public comments on a still-open ticket.
    const ownComment = c.authorId === actor.id && c.ticket.requesterId === actor.id && !c.isInternal;
    const ticketOpen = c.ticket.status !== "CLOSED" && c.ticket.status !== "CANCELLED";
    return ownComment && ticketOpen ? { commentId: target.commentId } : null;
  }

  if (target.kind === "aiProject") {
    // The blob attaches to a project file, whose access is owner-or-shared-member.
    // Attachment has no aiProject FK column (the join is AiProjectFile.attachmentId
    // @unique), so we return an empty FK — the caller creates the AiProjectFile row.
    const access = await loadAccessibleProject(actor, target.projectId);
    return access ? {} : null;
  }

  // article — agents only
  const a = await db.article.findUnique({ where: { id: target.articleId }, select: { id: true } });
  if (!a) return null;
  if (agent) return { articleId: target.articleId };
  return null;
}

/** Whether an actor (possibly anonymous) may download an attachment. */
export async function canViewAttachment(
  actor: SessionActor | null,
  att: { id?: string; ticketId: number | null; commentId: string | null; articleId: string | null },
): Promise<boolean> {
  const agent = !!actor && isAgent(actor.role);

  // A project-library file: allow when the actor can access its project. Checked
  // first because such blobs carry no ticket/comment/article FK.
  if (att.id) {
    const projFile = await db.aiProjectFile.findUnique({
      where: { attachmentId: att.id },
      select: { projectId: true },
    });
    if (projFile) {
      if (!actor) return false;
      return !!(await loadAccessibleProject(actor, projFile.projectId));
    }
  }

  if (att.ticketId != null) {
    if (agent) return true;
    const t = await db.ticket.findUnique({ where: { id: att.ticketId }, select: { requesterId: true } });
    return !!actor && !!t && t.requesterId === actor.id;
  }

  if (att.commentId != null) {
    const c = await db.ticketComment.findUnique({
      where: { id: att.commentId },
      select: { isInternal: true, ticket: { select: { requesterId: true } } },
    });
    if (!c) return false;
    if (agent) return true;
    // Requesters never see attachments on internal notes.
    if (c.isInternal) return false;
    return !!actor && c.ticket.requesterId === actor.id;
  }

  if (att.articleId != null) {
    if (agent) return true;
    const a = await db.article.findUnique({ where: { id: att.articleId }, select: { status: true, visibility: true } });
    return !!a && a.status === "PUBLISHED" && a.visibility === "PUBLIC";
  }

  return false;
}
