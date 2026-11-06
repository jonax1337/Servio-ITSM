import { Check, Minus } from "lucide-react";
import { aiConfigured, aiTeaserEnabled } from "@/lib/ai";
import { requireUser, isAgent } from "@/lib/session";
import { loadChangeBrief } from "@/lib/change-brief";
import { blastRadiusRisk, riskMismatch, type BriefApprovals, type BriefSchedule } from "@/lib/change-brief-rules";
import { APPROVAL_META, RISK_META } from "@/lib/constants";
import { StatusBadge } from "@/components/status-badge";
import { CabBriefProse } from "@/components/changes/cab-brief-prose";

export type ChangeCabBriefProps = { changeId: number };

function BriefSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

function ScheduleSummary({ schedule }: { schedule: BriefSchedule }) {
  const { conflicts, freezes } = schedule;
  if (conflicts.length === 0 && freezes.length === 0) return <p className="text-sm">No conflicts or freeze windows.</p>;
  return (
    <ul className="grid gap-1 text-sm text-amber-600 dark:text-amber-400">
      {conflicts.map((conflict) => (
        <li key={conflict.ref}>Overlaps with {conflict.ref} {conflict.title}</li>
      ))}
      {freezes.map((name, index) => (
        <li key={`${index}-${name}`}>Inside freeze window {name}</li>
      ))}
    </ul>
  );
}

function ApprovalSummary({ approvals }: { approvals: BriefApprovals | null }) {
  if (!approvals) return <p className="text-sm">Pre-authorized: a standard change from an approved template has no CAB vote.</p>;
  if (approvals.seated === 0) return <p className="text-sm text-muted-foreground">No approvers seated yet.</p>;
  return (
    <>
      <p className="text-sm">
        {approvals.approved} of {approvals.required} required approvals
        {approvals.satisfied ? " (rule met)" : ""}
        {approvals.pending > 0 ? `, ${approvals.pending} pending` : ""}
        {approvals.rejected > 0 ? `, ${approvals.rejected} rejected` : ""}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {approvals.approvers.map((approver, index) => (
          <li key={`${index}-${approver.name}`} className="flex items-center gap-1 text-xs">
            {approver.name}
            <StatusBadge map={APPROVAL_META} value={approver.status} dot={false} />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * A concise brief for the CAB: risk, impact, plan completeness and approver status, always computed
 * from the record. Sable adds a short prose recommendation on request when AI is on.
 */
export async function ChangeCabBrief({ changeId }: ChangeCabBriefProps) {
  const me = await requireUser();
  if (!me || !isAgent(me.role)) return null;

  const facts = await loadChangeBrief(changeId);
  if (!facts) return null;

  const enabled = await aiConfigured();
  const teaser = !enabled && (await aiTeaserEnabled());
  const mismatch = riskMismatch(facts.risk, facts.impactedCount);

  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">CAB brief</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <BriefSection title="Risk">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge map={RISK_META} value={facts.risk} />
            <span className="text-xs text-muted-foreground">
              Blast radius: {RISK_META[blastRadiusRisk(facts.impactedCount)].label.toLowerCase()}
            </span>
          </div>
          {mismatch ? <p className="text-xs text-amber-600 dark:text-amber-400">{mismatch}</p> : null}
        </BriefSection>

        <BriefSection title="Impact">
          <p className="text-sm">
            {facts.affected.length} affected CI{facts.affected.length === 1 ? "" : "s"}, {facts.impactedCount} downstream
          </p>
          {facts.affected.length > 0 ? (
            <p className="text-xs text-muted-foreground">{facts.affected.map((ci) => ci.name).join(", ")}</p>
          ) : null}
        </BriefSection>

        <BriefSection title="Plan completeness">
          <ul className="grid gap-1">
            {facts.plan.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5 text-sm">
                {item.done ? (
                  <Check className="size-3.5 text-emerald-600" aria-label="Done" />
                ) : (
                  <Minus className="size-3.5 text-muted-foreground" aria-label="Missing" />
                )}
                <span className={item.done ? undefined : "text-muted-foreground"}>{item.label}</span>
              </li>
            ))}
          </ul>
        </BriefSection>

        <BriefSection title="Schedule">
          <ScheduleSummary schedule={facts.schedule} />
        </BriefSection>

        <BriefSection title="Approvals">
          <ApprovalSummary approvals={facts.approvals} />
        </BriefSection>
      </div>

      {enabled || teaser ? <CabBriefProse changeId={changeId} teaser={teaser} /> : null}
    </section>
  );
}
