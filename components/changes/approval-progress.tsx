import { Gauge, Check } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { CabRuleEditor } from "@/components/changes/cab-rule-editor";
import { CAB_APPROVAL_RULE_META } from "@/lib/constants";
import type { CabTally } from "@/lib/cab";

/**
 * Renders the CAB decision rule and live progress toward it (e.g. "2 of 3
 * required approvals"). When `canSeat`, a manager can change the rule/threshold
 * inline via the embedded editor.
 */
export function ApprovalProgress({
  changeId,
  tally,
  threshold,
  canSeat,
}: {
  changeId: number;
  tally: CabTally;
  threshold: number | null;
  canSeat: boolean;
}) {
  const ruleMeta = CAB_APPROVAL_RULE_META[tally.rule];
  const pct = tally.required > 0 ? Math.min(100, Math.round((tally.approved / tally.required) * 100)) : 0;

  return (
    <div className="mb-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Gauge className="size-4 text-primary" />
          CAB decision rule
        </div>
        <div className="flex items-center gap-2">
          {ruleMeta ? <StatusBadge map={CAB_APPROVAL_RULE_META} value={tally.rule} /> : null}
          {tally.satisfied ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="size-3" /> Rule satisfied
            </span>
          ) : null}
        </div>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{tally.approved}</span> of{" "}
        <span className="font-medium text-foreground">{tally.required}</span> required approval
        {tally.required === 1 ? "" : "s"}
        {tally.rule === "PERCENT" && threshold != null ? <> ({threshold}% of {tally.seated} seats)</> : null}
        {tally.rejected > 0 ? <> · {tally.rejected} rejected</> : null}
        {tally.pending > 0 ? <> · {tally.pending} pending</> : null}
      </p>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={tally.satisfied ? "h-full bg-emerald-500" : "h-full bg-primary"}
          style={{ width: `${pct}%` }}
        />
      </div>

      {canSeat ? (
        <div className="mt-4">
          <CabRuleEditor
            changeId={changeId}
            rule={tally.rule}
            threshold={threshold}
            seated={tally.seated}
          />
        </div>
      ) : null}
    </div>
  );
}
