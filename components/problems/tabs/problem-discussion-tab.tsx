import { db } from "@/lib/db";
import { getEntityApprovals } from "@/lib/data/approvals";
import { EntityApprovals } from "@/components/approvals/entity-approvals";
import { CommentThread } from "@/components/comments/comment-thread";
import { addProblemComment } from "@/lib/actions/problems";
import type { FormOptions } from "@/lib/data/options";

export async function ProblemDiscussionTab({
  problem,
  currentUserId,
  isAdmin,
  canManage,
  isAgentUser,
  agents,
}: {
  problem: { id: number; title: string };
  currentUserId: string;
  isAdmin: boolean;
  canManage: boolean;
  isAgentUser: boolean;
  agents: FormOptions["agents"];
}) {
  const [rows, approvals] = await Promise.all([
    db.problemComment.findMany({
      where: { problemId: problem.id },
      include: { author: true },
      orderBy: { createdAt: "asc" },
    }),
    getEntityApprovals("PROBLEM", problem.id),
  ]);

  const comments = rows.map((c) => ({
    id: c.id, author: c.author.name ?? c.author.email, body: c.body, bodyHtml: c.bodyHtml, isInternal: c.isInternal, createdAt: c.createdAt, attachments: [],
  }));

  return (
    <div className="[&>:first-child]:mt-0">
      <EntityApprovals
        entityType="PROBLEM"
        entityId={String(problem.id)}
        entityTitle={problem.title}
        approvals={approvals}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
        canManage={canManage}
        canRequest={isAgentUser}
        agents={agents}
      />
      <div className="mt-8">
        <CommentThread
          idField="problemId"
          entityId={problem.id}
          comments={comments}
          addAction={addProblemComment}
        />
      </div>
    </div>
  );
}
