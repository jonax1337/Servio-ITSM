import { Check, X, Clock, User, Users, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

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
export function ApprovalProgress({
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

  const headline =
    state === "APPROVED"
      ? "Approved"
      : state === "REJECTED"
        ? "Declined"
        : state === "CANCELLED"
          ? "Cancelled before a decision"
          : `Awaiting approval${stages.length > 1 && liveIndex >= 0 ? ` — stage ${liveIndex + 1} of ${stages.length}` : ""}`;

  return (
    <div className={cn("rounded-2xl border bg-card p-6", className)}>
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-muted-foreground">Approval</h2>
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
                    {stages.length > 1 ? `Stage ${i + 1}` : "Approval"}
                  </span>
                  {s.approverName ? (
                    <span className="truncate text-sm text-muted-foreground">· {s.approverName}</span>
                  ) : s.kind === "group" ? (
                    <span className="text-sm text-muted-foreground">· group approval</span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {s.status === "APPROVED"
                    ? `Approved${s.decidedAt ? ` · ${format(s.decidedAt, "PP")}` : ""}`
                    : s.status === "REJECTED"
                      ? `Declined${s.decidedAt ? ` · ${format(s.decidedAt, "PP")}` : ""}`
                      : s.status === "CANCELLED" || settled
                        ? "Not decided"
                        : isLive
                          ? "Waiting for a decision"
                          : "Pending earlier stages"}
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
