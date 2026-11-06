"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { decideApproval } from "@/lib/actions/approvals";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ApprovalDecision({ approvalId }: { approvalId: string }) {
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function decide(decision: "APPROVED" | "REJECTED") {
    const fd = new FormData();
    fd.set("approvalId", approvalId);
    fd.set("decision", decision);
    if (comment.trim()) fd.set("comment", comment.trim());
    start(async () => {
      const res = await decideApproval(fd);
      if (!res.ok) {
        setError(res.error ?? "The decision could not be recorded.");
        toast.error(res.error ?? "The decision could not be recorded.");
        return;
      }
      setError(null);
      setRejecting(false);
      toast.success(decision === "APPROVED" ? "Approval recorded" : "Rejection recorded");
    });
  }

  if (rejecting) {
    return (
      <div className="grid w-full gap-2 sm:w-80">
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Reason for rejection (optional)…"
          className="min-h-16"
        />
        <p className="text-xs text-muted-foreground">Visible to the requester.</p>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setRejecting(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={() => decide("REJECTED")} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} Confirm reject
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setRejecting(true)} disabled={pending}>
          <X className="size-4" /> Reject
        </Button>
        <Button size="sm" onClick={() => decide("APPROVED")} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Approve
        </Button>
      </div>
      {error ? <p role="alert" className="max-w-xs text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
