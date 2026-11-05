"use client";

import { Send } from "lucide-react";
import { toast } from "sonner";
import { submitChangeForApproval } from "@/lib/actions/changes";
import { ConfirmButton } from "@/components/confirm-dialog";

export function SubmitForApproval({
  changeId, isStandard, approverCount,
}: {
  changeId: number;
  isStandard: boolean;
  approverCount: number;
}) {
  const description = isStandard
    ? "This is a Standard (pre-authorized) change — submitting moves it straight to Approved."
    : approverCount > 0
      ? "This re-requests a CAB decision. Approvers are selected automatically by change type and risk."
      : "This requests a CAB decision. Approvers are selected automatically by change type and risk.";

  const submit = async (formData: FormData) => {
    const res = await submitChangeForApproval(formData);
    if (res.ok) toast.success("Submitted for approval");
    else toast.error(res.error ?? "Could not submit the change.");
  };

  return (
    <ConfirmButton
      action={submit}
      fields={{ id: changeId }}
      title="Submit for approval?"
      description={description}
      confirmLabel="Submit"
      confirmVariant="default"
      triggerVariant="default"
      triggerSize="sm"
      triggerLabel="Submit for approval"
    >
      <Send className="size-3.5" /> Submit for approval
    </ConfirmButton>
  );
}
