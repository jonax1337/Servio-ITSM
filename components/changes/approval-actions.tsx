"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { decideApproval } from "@/lib/actions/changes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ApprovalActions({ approvalId }: { approvalId: string }) {
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
        setError(res.error);
        toast.error(res.error);
        return;
      }
      setError(null);
      setComment("");
      toast.success(decision === "APPROVED" ? "Approval recorded" : "Rejection recorded");
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add a comment (optional)"
        className="h-7 flex-1 min-w-40 text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => decide("APPROVED")}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        Approve
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => decide("REJECTED")}
      >
        <X className="size-3.5" /> Reject
      </Button>
      {error ? <p role="alert" className="basis-full text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
