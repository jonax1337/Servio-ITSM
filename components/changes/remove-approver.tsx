"use client";

import { UserMinus } from "lucide-react";
import { removeChangeApprover } from "@/lib/actions/changes";
import { ConfirmButton } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n/client";

export function RemoveApprover({ approvalId, approverName }: { approvalId: string; approverName: string }) {
  const t = useT("changes");
  const tc = useT("common");
  return (
    <ConfirmButton
      action={removeChangeApprover}
      fields={{ approvalId }}
      title={t("approvers.removeTitle")}
      description={t("approvers.removeDescription", { name: approverName })}
      confirmLabel={tc("remove")}
      successMessage={t("approvers.removed")}
      triggerVariant="ghost"
      triggerSize="icon-sm"
      triggerLabel={t("approvers.remove")}
    >
      <UserMinus className="size-3.5" />
    </ConfirmButton>
  );
}
