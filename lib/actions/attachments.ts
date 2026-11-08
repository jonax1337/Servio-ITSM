"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentUser, isAgent, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { storage } from "@/lib/storage";
import { mayWriteRecordAttachment, recordTargetOf } from "@/lib/attachment-rules";

export async function deleteAttachment(formData: FormData): Promise<{ error?: string } | void> {
  const me = await getCurrentUser();
  if (!me || !me.isActive) return { error: "Not authorised" };
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const att = await db.attachment.findUnique({
    where: { id },
    select: {
      id: true, filename: true, storageKey: true, uploadedById: true,
      ticketId: true, commentId: true, articleId: true,
      changeId: true, problemId: true, assetId: true, licenseId: true,
      article: { select: { authorId: true, slug: true } },
    },
  });
  if (!att) return; // idempotent

  const agent = isAgent(me.role as Role);
  const isTicketTarget = att.ticketId != null || att.commentId != null;
  const isArticleTarget = att.articleId != null;
  // Changes, problems, assets and licenses are staff records: any agent (licenses
  // MANAGER+), and an uploader who lost that right cannot delete there either.
  const recordTarget = recordTargetOf(att);
  const allowed = recordTarget
    ? mayWriteRecordAttachment(me.role, recordTarget)
    : att.uploadedById === me.id ||
      (isTicketTarget && agent) ||
      (isArticleTarget && (agent || att.article?.authorId === me.id));
  if (!allowed) return { error: "Not authorised" };

  // Delete the row first (authz already passed); only remove the blob once the
  // row is gone, so a failed row-delete never leaves a row pointing at no blob.
  const del = await db.attachment.deleteMany({ where: { id } });
  if (del.count === 0) return; // already deleted (idempotent) — nothing to audit
  if (att.storageKey) await storage.delete(att.storageKey).catch(() => {});

  await writeAudit({ userId: me.id, action: "DELETE", entity: "Attachment", entityId: id, summary: `Deleted "${att.filename}"` });

  if (att.ticketId != null) {
    revalidatePath(`/tickets/${att.ticketId}`);
    revalidatePath(`/portal/tickets/${att.ticketId}`);
  }
  // Comment-parented files have ticketId=null — resolve the ticket via the comment.
  if (att.commentId != null) {
    const c = await db.ticketComment.findUnique({ where: { id: att.commentId }, select: { ticketId: true } });
    if (c) {
      revalidatePath(`/tickets/${c.ticketId}`);
      revalidatePath(`/portal/tickets/${c.ticketId}`);
    }
  }
  if (att.article?.slug) revalidatePath(`/knowledge/${att.article.slug}`);
  if (att.changeId != null) revalidatePath(`/changes/${att.changeId}`);
  if (att.problemId != null) revalidatePath(`/problems/${att.problemId}`);
  if (att.assetId != null) revalidatePath(`/assets/${att.assetId}`);
  if (att.licenseId != null) revalidatePath(`/contracts/licenses/${att.licenseId}`);
}
