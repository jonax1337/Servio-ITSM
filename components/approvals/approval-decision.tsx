"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { decideApproval } from "@/lib/actions/approvals";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ApprovalDecision({ approvalId }: { approvalId: string }) {
  const [rejecting, setRejecting] = useState(false);

  if (rejecting) {
    return (
      <form action={decideApproval} className="grid w-full gap-2 sm:w-80">
        <input type="hidden" name="approvalId" value={approvalId} />
        <input type="hidden" name="decision" value="REJECTED" />
        <Textarea name="comment" placeholder="Reason for rejection (optional)…" className="min-h-16" />
        <p className="text-xs text-muted-foreground">Visible to the requester.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" size="sm">
            <X className="size-4" /> Confirm reject
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setRejecting(true)}>
        <X className="size-4" /> Reject
      </Button>
      <form action={decideApproval}>
        <input type="hidden" name="approvalId" value={approvalId} />
        <input type="hidden" name="decision" value="APPROVED" />
        <Button type="submit" size="sm">
          <Check className="size-4" /> Approve
        </Button>
      </form>
    </div>
  );
}
