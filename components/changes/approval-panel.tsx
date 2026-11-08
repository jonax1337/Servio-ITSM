import { ShieldCheck, CheckCircle2 } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { StatusBadge } from "@/components/status-badge";
import { ApprovalActions } from "@/components/changes/approval-actions";
import { AddApprover } from "@/components/changes/add-approver";
import { RemoveApprover } from "@/components/changes/remove-approver";
import { APPROVAL_META } from "@/lib/constants";
import { canSeatApprovers } from "@/lib/change-rules";
import { changeSelfApprovalError } from "@/lib/approval-rules";
import { Info } from "lucide-react";
import type { ComboOption } from "@/components/combobox";
import { getFormatter, getServerMessageT, getT } from "@/lib/i18n/server";

export type ApprovalRow = {
  id: string;
  approver: { id: string; name: string | null; email: string };
  status: string;
  comment: string | null;
  decidedAt: Date | null;
};

export async function ApprovalPanel({
  preAuthorized, changeStatus, approvals, currentUserId, canManage, changeId, agentOptions, change,
}: {
  /** Who raised and owns the change: they may not decide its approvals. */
  change: { createdById: string | null; assigneeId: string | null };
  /** Created from an approved standard template: no board decides it. */
  preAuthorized: boolean;
  changeStatus: string;
  approvals: ApprovalRow[];
  currentUserId: string;
  canManage: boolean;
  changeId: number;
  agentOptions: ComboOption[];
}) {
  const canSeat = canManage && !preAuthorized && canSeatApprovers(changeStatus);
  const selfApproval = changeSelfApprovalError(change, currentUserId);
  const [t, f, tm] = await Promise.all([getT("changes"), getFormatter(), getServerMessageT()]);

  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-muted-foreground" />
          {t("approvalPanel.title", { count: approvals.length })}
        </h2>
        {canSeat ? <AddApprover changeId={changeId} agentOptions={agentOptions} /> : null}
      </div>

      {preAuthorized ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed bg-card/50 px-4 py-6 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-emerald-500" />
          {t("approvalPanel.preAuthorized")}
        </div>
      ) : (
        <div className="grid gap-3">
          {approvals.map((a) => (
            <div key={a.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-center gap-3">
                <UserAvatar name={a.approver.name} email={a.approver.email} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{a.approver.name ?? a.approver.email}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.decidedAt
                      ? t("approvalPanel.decided", { time: f.relative(a.decidedAt) })
                      : changeStatus === "DRAFT" ? t("approvalPanel.askedOnSubmit") : t("approvalPanel.awaiting")}
                  </div>
                </div>
                <StatusBadge map={APPROVAL_META} value={a.status} />
                {canManage && a.status === "PENDING" ? (
                  <RemoveApprover approvalId={a.id} approverName={a.approver.name ?? a.approver.email} />
                ) : null}
              </div>
              {a.comment ? (
                <p className="mt-2 whitespace-pre-wrap rounded-lg border bg-muted/30 p-2 text-xs text-muted-foreground">
                  {a.comment}
                </p>
              ) : null}
              {/* Only the current user's own pending row gets the decision controls (matches server SoD). */}
              {a.status === "PENDING" && a.approver.id === currentUserId ? (
                selfApproval ? (
                  <p className="mt-2 flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    {tm(selfApproval)}
                  </p>
                ) : (
                  <ApprovalActions approvalId={a.id} />
                )
              ) : null}
            </div>
          ))}
          {approvals.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-dashed bg-card/50 px-4 py-6 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4" />
              {canManage ? t("approvalPanel.emptyManager") : t("approvalPanel.empty")}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
