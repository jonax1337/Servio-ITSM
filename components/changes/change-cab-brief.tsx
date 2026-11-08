import { Check, Minus } from "lucide-react";
import { aiConfigured, aiTeaserEnabled } from "@/lib/ai";
import { requireUser, isAgent } from "@/lib/session";
import { loadChangeBrief } from "@/lib/change-brief";
import { blastRadiusRisk, riskMismatch, type BriefApprovals, type BriefSchedule } from "@/lib/change-brief-rules";
import { APPROVAL_META, RISK_META } from "@/lib/constants";
import { getEnumT, getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate";

type T = Translator<"changes">;
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

function ScheduleSummary({ schedule, t }: { schedule: BriefSchedule; t: T }) {
  const { conflicts, freezes } = schedule;
  if (conflicts.length === 0 && freezes.length === 0) return <p className="text-sm">{t("brief.noConflicts")}</p>;
  return (
    <ul className="grid gap-1 text-sm text-amber-600 dark:text-amber-400">
      {conflicts.map((conflict) => (
        <li key={conflict.ref}>{t("brief.overlaps", { ref: conflict.ref, title: conflict.title })}</li>
      ))}
      {freezes.map((name, index) => (
        <li key={`${index}-${name}`}>{t("brief.insideFreeze", { name })}</li>
      ))}
    </ul>
  );
}

function ApprovalSummary({ approvals, t }: { approvals: BriefApprovals | null; t: T }) {
  if (!approvals) return <p className="text-sm">{t("brief.preAuthorized")}</p>;
  if (approvals.seated === 0) return <p className="text-sm text-muted-foreground">{t("brief.noApprovers")}</p>;
  return (
    <>
      <p className="text-sm">
        {t("brief.approvalCount", { approved: approvals.approved, required: approvals.required })}
        {approvals.satisfied ? ` ${t("brief.ruleMet")}` : ""}
        {approvals.pending > 0 ? `, ${t("cabRule.pending", { count: approvals.pending })}` : ""}
        {approvals.rejected > 0 ? `, ${t("cabRule.rejected", { count: approvals.rejected })}` : ""}
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
  const [t, te] = await Promise.all([getT("changes"), getEnumT()]);
  const suggested = blastRadiusRisk(facts.impactedCount);
  // riskMismatch decides; the sentence is rebuilt in the viewer's language.
  const mismatch = riskMismatch(facts.risk, facts.impactedCount)
    ? t("brief.riskMismatch", {
        declared: te(RISK_META, facts.risk).toLowerCase(),
        count: facts.impactedCount,
        suggested: te(RISK_META[suggested]).toLowerCase(),
      })
    : null;

  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">{t("brief.title")}</h3>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <BriefSection title={t("brief.risk")}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge map={RISK_META} value={facts.risk} />
            <span className="text-xs text-muted-foreground">
              {t("brief.blastRadius", { level: te(RISK_META[suggested]).toLowerCase() })}
            </span>
          </div>
          {mismatch ? <p className="text-xs text-amber-600 dark:text-amber-400">{mismatch}</p> : null}
        </BriefSection>

        <BriefSection title={t("brief.impact")}>
          <p className="text-sm">
            {t("brief.impactCount", { count: facts.affected.length, downstream: facts.impactedCount })}
          </p>
          {facts.affected.length > 0 ? (
            <p className="text-xs text-muted-foreground">{facts.affected.map((ci) => ci.name).join(", ")}</p>
          ) : null}
        </BriefSection>

        <BriefSection title={t("brief.plan")}>
          <ul className="grid gap-1">
            {facts.plan.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5 text-sm">
                {item.done ? (
                  <Check className="size-3.5 text-emerald-600" aria-label={t("brief.done")} />
                ) : (
                  <Minus className="size-3.5 text-muted-foreground" aria-label={t("brief.missing")} />
                )}
                <span className={item.done ? undefined : "text-muted-foreground"}>{t.dyn(`brief.planItem.${item.label}`, undefined, item.label)}</span>
              </li>
            ))}
          </ul>
        </BriefSection>

        <BriefSection title={t("brief.schedule")}>
          <ScheduleSummary schedule={facts.schedule} t={t} />
        </BriefSection>

        <BriefSection title={t("brief.approvals")}>
          <ApprovalSummary approvals={facts.approvals} t={t} />
        </BriefSection>
      </div>

      {enabled || teaser ? <CabBriefProse changeId={changeId} teaser={teaser} /> : null}
    </section>
  );
}
