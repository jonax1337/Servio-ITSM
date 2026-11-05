"use client";

import { UserMinus } from "lucide-react";
import { removeChangeApprover } from "@/lib/actions/changes";
import { ConfirmButton } from "@/components/confirm-dialog";

export function RemoveApprover({ approvalId, approverName }: { approvalId: string; approverName: string }) {
  return (
    <ConfirmButton
      action={removeChangeApprover}
      fields={{ approvalId }}
      title="Remove approver?"
      description={`${approverName} will be removed from this change's approvers.`}
      confirmLabel="Remove"
      successMessage="Approver removed"
      triggerVariant="ghost"
      triggerSize="icon-sm"
      triggerLabel="Remove approver"
    >
      <UserMinus className="size-3.5" />
    </ConfirmButton>
  );
}
