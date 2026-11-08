import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { getEntityApprovals } from "@/lib/data/approvals";
import { approverRolesForRisk, evaluateCab } from "@/lib/cab";
import { canSeatApprovers, isTemplatedStandard } from "@/lib/change-rules";
import { initials } from "@/lib/avatar";
import { ApprovalPanel, type ApprovalRow } from "@/components/changes/approval-panel";
import { ApprovalProgress } from "@/components/changes/approval-progress";
import { ChangeCabBrief } from "@/components/changes/change-cab-brief";
import { EntityApprovals } from "@/components/approvals/entity-approvals";
import type { ComboOption } from "@/components/combobox";
import type { ChangeTabContext } from "@/components/changes/tabs/types";
import { getT } from "@/lib/i18n/server";

export async function CabTab({ change, userId, isAgent, canManage, isAdmin }: ChangeTabContext) {
  const [approvals, adHocApprovals, options, eligibleApprovers] = await Promise.all([
    db.changeApproval.findMany({
      where: { changeId: change.id },
      include: { approver: true },
      orderBy: { createdAt: "asc" },
    }),
    getEntityApprovals("CHANGE", change.id),
    getFormOptions(),
    // Offer only people addChangeApprover will actually seat (role per risk, SoD).
    db.user.findMany({
      where: { role: { in: approverRolesForRisk(change.risk) }, isActive: true },
      select: { id: true },
    }),
  ]);

  const t = await getT("changes");
  const eligibleIds = new Set(eligibleApprovers.map((u) => u.id));
  const seatedIds = new Set(approvals.map((a) => a.approverId));
  const agentOptions: ComboOption[] = options.agents
    .filter((a) => eligibleIds.has(a.id) && !seatedIds.has(a.id) && a.id !== change.assigneeId && a.id !== change.createdById)
    .map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email }));
  const approvalRows: ApprovalRow[] = approvals.map((a) => ({
    id: a.id,
    approver: { id: a.approver.id, name: a.approver.name, email: a.approver.email },
    status: a.status,
    comment: a.comment,
    decidedAt: a.decidedAt,
  }));

  const cabTally = evaluateCab(approvals.map((a) => a.status), change.approvalRule, change.approvalThreshold);
  // Managers may re-tune the rule while the board is being seated (DRAFT/APPROVAL,
  // not template-pre-approved). Matches the server-side gate in setCabRule.
  const preAuthorized = isTemplatedStandard(change);
  const canSeatRule = canManage && !preAuthorized && canSeatApprovers(change.status);

  return (
    <div className="grid gap-8">
      {!preAuthorized && (approvals.length > 0 || canSeatRule) ? (
        <div className="[&>div]:mb-0">
          <ApprovalProgress
            changeId={change.id}
            tally={cabTally}
            threshold={change.approvalThreshold}
            canSeat={canSeatRule}
          />
        </div>
      ) : null}
      <div className="[&>div]:mt-0">
        <ApprovalPanel
          changeId={change.id}
          preAuthorized={preAuthorized}
          changeStatus={change.status}
          approvals={approvalRows}
          currentUserId={userId}
          change={change}
          canManage={canManage}
          agentOptions={agentOptions}
        />
      </div>

      <ChangeCabBrief changeId={change.id} />

      <div className="grid gap-4">
        <p className="rounded-lg border border-dashed bg-card/50 px-3 py-2 text-xs text-muted-foreground">
          {t("cab.adHocNote")}
        </p>
        <EntityApprovals
          entityType="CHANGE"
          entityId={String(change.id)}
          entityTitle={change.title}
          heading={t("cab.adHocHeading")}
          approvals={adHocApprovals}
          currentUserId={userId}
          isAdmin={isAdmin}
          canManage={canManage}
          canRequest={isAgent}
          agents={options.agents}
        />
      </div>
    </div>
  );
}
