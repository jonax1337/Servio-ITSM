import Link from "next/link";
import { GitPullRequestArrow } from "lucide-react";
import { db } from "@/lib/db";
import { StatusBadge } from "@/components/status-badge";
import { ProblemChangePicker, UnlinkChangeButton } from "@/components/problems/problem-fix-changes";
import { CHANGE_STATUS_META, changeRef } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";

export async function ProblemChangesTab({
  problemId,
  isAgentUser,
}: {
  problemId: number;
  isAgentUser: boolean;
}) {
  const t = await getT("problems");
  const [changes, linkableChanges] = await Promise.all([
    db.change.findMany({
      where: { problemId },
      select: { id: true, title: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
    isAgentUser
      ? db.change.findMany({
          where: { problemId: null, status: { not: "CANCELLED" } },
          select: { id: true, title: true },
          orderBy: { updatedAt: "desc" },
          take: 100,
        })
      : [],
  ]);
  const changeOpts = linkableChanges.map((c) => ({ value: String(c.id), label: `${changeRef(c.id)} · ${c.title}` }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <GitPullRequestArrow className="size-4 text-muted-foreground" />
          {t("changes.heading", { count: changes.length })}
        </h2>
        {isAgentUser ? <ProblemChangePicker problemId={problemId} options={changeOpts} /> : null}
      </div>
      {changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("changes.empty")}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {changes.map((c) => (
            <div
              key={c.id}
              className="group/chip flex items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-accent"
            >
              <Link href={`/changes/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">{changeRef(c.id)}</span>
                <span className="line-clamp-1 flex-1 text-sm font-medium">{c.title}</span>
                <StatusBadge map={CHANGE_STATUS_META} value={c.status} />
              </Link>
              {isAgentUser ? <UnlinkChangeButton changeId={c.id} /> : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
