import { FileText, Flag } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { StatusBadge } from "@/components/status-badge";
import { ChangeTextCard } from "@/components/changes/change-editors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sanitizeCommentHtml } from "@/lib/markdown";
import { isTemplatedStandard, submitBlockers } from "@/lib/change-rules";
import { loadChangeScheduleCheck } from "@/lib/change-schedule";
import { CHANGE_OUTCOME_META } from "@/lib/constants";
import { tabHref } from "@/lib/entity-tabs";
import { DEFAULT_CHANGE_TAB } from "@/components/changes/tabs/change-tabs";
import { changeNextStep, type NextStep } from "@/components/changes/tabs/next-step";
import type { ChangeTabContext } from "@/components/changes/tabs/types";

/** Tells the person working on the change what to do next, so the lifecycle never has to be guessed. */
function NextStepCard({ changeId, step }: { changeId: number; step: NextStep }) {
  return (
    <section aria-label="Next step" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-primary/25 bg-primary/5 p-4">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Next step</p>
        <h2 className="mt-0.5 text-sm font-semibold">{step.title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{step.detail}</p>
      </div>
      {step.tab ? (
        <LinkButton
          href={tabHref(`/changes/${changeId}`, {}, step.tab.key, DEFAULT_CHANGE_TAB)}
          variant="outline"
          size="sm"
        >
          {step.tab.label}
        </LinkButton>
      ) : null}
    </section>
  );
}

/** Names of the freezes a draft's window falls inside; only a draft can still be refused for it. */
async function freezeNamesOf(change: ChangeTabContext["change"]): Promise<string[]> {
  if (change.status !== "DRAFT") return [];
  const check = await loadChangeScheduleCheck(change.id);
  return check?.freezeHits.map((freeze) => freeze.name) ?? [];
}

export async function OverviewTab({ change, approvals, isAgent, canEdit }: ChangeTabContext) {
  const hasClosureRecord = change.outcome || change.closureNotes || change.cancelReason;
  const preAuthorized = isTemplatedStandard(change);
  const nextStep = isAgent
    ? changeNextStep({
        status: change.status,
        type: change.type,
        preAuthorized,
        submitBlockers: submitBlockers(change, preAuthorized),
        freezeNames: await freezeNamesOf(change),
        seatedApprovers: approvals.seated,
        pendingApprovals: approvals.pending,
      })
    : null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {nextStep ? <NextStepCard changeId={change.id} step={nextStep} /> : null}
      <div className="rounded-xl border bg-card p-4 text-sm leading-relaxed">
        {change.descriptionHtml ? (
          <div className="prose prose-sm dark:prose-invert max-w-none wrap-anywhere prose-pre:overflow-x-auto prose-table:block prose-table:overflow-x-auto" dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(change.descriptionHtml) }} />
        ) : change.description ? (
          <div className="whitespace-pre-wrap wrap-anywhere">{change.description}</div>
        ) : (
          <span className="text-muted-foreground">No description provided.</span>
        )}
      </div>

      <ChangeTextCard
        id={change.id}
        field="reason"
        label="Reason for change"
        icon={<FileText className="size-4 text-muted-foreground" />}
        value={change.reason}
        emptyText="Not documented yet."
        editable={canEdit}
      />

      {hasClosureRecord ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Flag className="size-4 text-muted-foreground" />
              {change.status === "CANCELLED" ? "Cancellation" : "Closure"}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm leading-relaxed">
            {change.outcome ? (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Outcome</span>
                <StatusBadge map={CHANGE_OUTCOME_META} value={change.outcome} dot />
              </div>
            ) : null}
            {change.closureNotes ? <p className="whitespace-pre-wrap">{change.closureNotes}</p> : null}
            {change.cancelReason ? <p className="whitespace-pre-wrap">{change.cancelReason}</p> : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
