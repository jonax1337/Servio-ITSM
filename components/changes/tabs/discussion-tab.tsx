import { db } from "@/lib/db";
import { CommentThread } from "@/components/comments/comment-thread";
import { addChangeComment } from "@/lib/actions/changes";
import type { ChangeTabContext } from "@/components/changes/tabs/types";

/** Comments only; the audit trail has its own History tab. */
export async function DiscussionTab({ change }: ChangeTabContext) {
  const rows = await db.changeComment.findMany({
    where: { changeId: change.id },
    include: { author: true },
    orderBy: { createdAt: "asc" },
  });
  const comments = rows.map((c) => ({
    id: c.id,
    author: c.author.name ?? c.author.email,
    body: c.body,
    bodyHtml: c.bodyHtml,
    isInternal: c.isInternal,
    createdAt: c.createdAt,
    attachments: [],
  }));

  return (
    <CommentThread
      idField="changeId"
      entityId={change.id}
      comments={comments}
      addAction={addChangeComment}
    />
  );
}
