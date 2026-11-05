import { ShieldCheck, CheckCircle2 } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { StatusBadge } from "@/components/status-badge";
import { ApprovalActions } from "@/components/changes/approval-actions";
import { AddApprover } from "@/components/changes/add-approver";
import { RemoveApprover } from "@/components/changes/remove-approver";
import { APPROVAL_META } from "@/lib/constants";
import { canSeatApprovers } from "@/lib/change-rules";
import type { ComboOption } from "@/components/combobox";
import { formatDistanceToNow } from "date-fns";

export type ApprovalRow = {
  id: string;
  approver: { id: string; name: string | null; email: string };
  status: string;
  comment: string | null;
  decidedAt: Date | null;
};

export function ApprovalPanel({
  changeType, changeStatus, approvals, currentUserId, canManage, changeId, agentOptions,
}: {
  changeType: string;
  changeStatus: string;
  approvals: ApprovalRow[];
  currentUserId: string;
  canManage: boolean;
  changeId: number;
  agentOptions: ComboOption[];
}) {
  const canSeat = canManage && changeType !== "STANDARD" && canSeatApprovers(changeStatus);

  return (
    <div className="mt-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-muted-foreground" />
          CAB approvals · {approvals.length}
        </h2>
        {canSeat ? <AddApprover changeId={changeId} agentOptions={agentOptions} /> : null}
      </div>

      {changeType === "STANDARD" ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed bg-card/50 px-4 py-6 text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-emerald-500" />
          Standard change — pre-approved. No CAB decision required; submitting moves it straight to Approved.
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
                      ? `Decided ${formatDistanceToNow(a.decidedAt, { addSuffix: true })}`
                      : changeStatus === "DRAFT" ? "Will be asked on submit" : "Awaiting decision"}
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
                <ApprovalActions approvalId={a.id} />
              ) : null}
            </div>
          ))}
          {approvals.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-dashed bg-card/50 px-4 py-6 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4" />
              No approvers yet.{canManage ? " Submit for approval to build the CAB automatically, or add approvers above." : ""}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
