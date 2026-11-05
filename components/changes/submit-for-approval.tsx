"use client";

import { Send } from "lucide-react";
import { submitChangeForApproval } from "@/lib/actions/changes";
import { submitBlockedMessage } from "@/lib/change-rules";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";

export function SubmitForApproval({
  changeId, isStandard, approverCount, missing,
}: {
  changeId: number;
  isStandard: boolean;
  approverCount: number;
  /** What the change still lacks before it can be submitted (see submitBlockers). */
  missing: string[];
}) {
  if (missing.length > 0) {
    const hint = submitBlockedMessage(missing);
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" title={hint}>
        <Button type="button" size="sm" disabled>
          <Send className="size-3.5" /> Submit for approval
        </Button>
        <span className="max-w-64 text-xs text-muted-foreground">{hint}</span>
      </span>
    );
  }

  const description = isStandard
    ? "This is a Standard (pre-authorized) change — submitting moves it straight to Approved."
    : approverCount > 0
      ? "Approvers already added stay on the board; the rest are selected automatically by change type and risk."
      : "This requests a CAB decision. Approvers are selected automatically by change type and risk.";

  return (
    <ConfirmButton
      action={submitChangeForApproval}
      successMessage="Submitted for approval"
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
