"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { decideEntityApproval } from "@/lib/actions/approvals";
import { Button } from "@/components/ui/button";
import { useServerMessage, useT } from "@/lib/i18n/client";
import { Input } from "@/components/ui/input";

/** Compact approve/reject control for a generic ad-hoc approval (used in the hub). */
export function EntityApprovalDecision({ approvalId }: { approvalId: string }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const t = useT("approvals");
  const tm = useServerMessage();

  function decide(decision: "APPROVED" | "REJECTED") {
    const fd = new FormData();
    fd.set("approvalId", approvalId);
    fd.set("decision", decision);
    if (comment.trim()) fd.set("comment", comment.trim());
    start(async () => {
      const res = await decideEntityApproval(fd);
      if (!res.ok) {
        const message = res.error ? tm(res.error) : t("decision.failed");
        setError(message);
        toast.error(message);
        return;
      }
      setError(null);
      setComment("");
      toast.success(decision === "APPROVED" ? t("decision.approved") : t("decision.rejected"));
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t("decision.comment")}
        className="h-7 min-w-40 flex-1 text-xs"
      />
      <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("APPROVED")}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        {t("decision.approve")}
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("REJECTED")}>
        <X className="size-3.5" /> {t("decision.reject")}
      </Button>
      {error ? <p role="alert" className="basis-full text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
