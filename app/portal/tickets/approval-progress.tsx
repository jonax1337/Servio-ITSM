import { Check, X, Clock, User, Users, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { getFormatter, getT } from "@/lib/i18n/server";

type StageStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export type ProgressStage = {
  index: number;
  kind: "user" | "group";
  status: StageStatus;
  approverName: string | null;
  decidedAt: Date | null;
  /** The approver's note on their decision (why it was approved or declined). */
  comment: string | null;
};

/**
 * Requester-facing view of a catalog request's multi-stage approval walk. Shows
 * each ordered stage, which one is currently live, and the outcome once decided.
 * Renders for single-stage items too (a compact one-row timeline).
 */
export async function ApprovalProgress({
  stages,
  state,
  className,
}: {
  stages: ProgressStage[];
  state: string;
  className?: string;
}) {
  // The live stage is the first non-decided one, unless the whole request settled.
  const liveIndex = stages.findIndex((s) => s.status === "PENDING");
  const settled = state !== "PENDING";
  const [t, f] = await Promise.all([getT("portal"), getFormatter()]);

  const headline =
    state === "APPROVED"
      ? t("approval.approved")
      : state === "REJECTED"
        ? t("approval.declined")
        : state === "CANCELLED"
          ? t("approval.cancelled")
          : stages.length > 1 && liveIndex >= 0
            ? t("approval.awaitingStage", { stage: liveIndex + 1, total: stages.length })
            : t("approval.awaiting");

  return (
    <div className={cn("rounded-2xl border bg-card p-6", className)}>
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-muted-foreground">{t("approval")}</h2>
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-xs font-medium",
            state === "APPROVED"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : state === "REJECTED"
                ? "bg-destructive/10 text-destructive"
                : state === "CANCELLED"
                  ? "bg-muted text-muted-foreground"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          )}
        >
          {headline}
        </span>
      </div>

      <ol className="grid gap-0">
        {stages.map((s, i) => {
          const isLive = !settled && i === liveIndex;
          const done = s.status !== "PENDING";
          const KindIcon = s.kind === "group" ? Users : User;
          return (
            <li key={s.index} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full border",
                    s.status === "APPROVED"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : s.status === "REJECTED"
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : isLive
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "border-border bg-muted/40 text-muted-foreground",
                  )}
                >
                  {s.status === "APPROVED" ? (
                    <Check className="size-3.5" />
                  ) : s.status === "REJECTED" ? (
                    <X className="size-3.5" />
                  ) : isLive ? (
                    <Clock className="size-3.5" />
                  ) : (
                    <span className="text-xs font-semibold tabular-nums">{i + 1}</span>
                  )}
                </span>
                {i < stages.length - 1 ? (
                  <span className={cn("my-0.5 w-px flex-1", done ? "bg-emerald-500/30" : "bg-border")} />
                ) : null}
              </div>
              <div className={cn("min-w-0 flex-1", i < stages.length - 1 ? "pb-4" : "")}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <KindIcon className="size-3.5 text-muted-foreground" />
                    {stages.length > 1 ? t("stage", { stage: i + 1 }) : t("approval")}
                  </span>
                  {s.approverName ? (
                    <span className="truncate text-sm text-muted-foreground">· {s.approverName}</span>
                  ) : s.kind === "group" ? (
                    <span className="text-sm text-muted-foreground">· {t("groupApproval")}</span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {s.status === "APPROVED"
                    ? s.decidedAt ? t("approvedOn", { date: f.date(s.decidedAt) }) : t("approval.approved")
                    : s.status === "REJECTED"
                      ? s.decidedAt ? t("declinedOn", { date: f.date(s.decidedAt) }) : t("approval.declined")
                      : s.status === "CANCELLED" || settled
                        ? t("notDecided")
                        : isLive
                          ? t("waitingDecision")
                          : t("pendingEarlier")}
                </p>
                {s.comment ? (
                  <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2 text-sm">{s.comment}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
