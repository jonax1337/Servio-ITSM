"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { decideApproval } from "@/lib/actions/approvals";
import { Button } from "@/components/ui/button";
import { useServerMessage, useT } from "@/lib/i18n/client";
import { Textarea } from "@/components/ui/textarea";

export function ApprovalDecision({ approvalId }: { approvalId: string }) {
  const [rejecting, setRejecting] = useState(false);
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
      const res = await decideApproval(fd);
      if (!res.ok) {
        const message = res.error ? tm(res.error) : t("decision.failed");
        setError(message);
        toast.error(message);
        return;
      }
      setError(null);
      setRejecting(false);
      toast.success(decision === "APPROVED" ? t("decision.approved") : t("decision.rejected"));
    });
  }

  if (rejecting) {
    return (
      <div className="grid w-full gap-2 sm:w-80">
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t("decision.rejectReason")}
          className="min-h-16"
        />
        <p className="text-xs text-muted-foreground">{t("decision.visibleToRequester")}</p>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setRejecting(false)} disabled={pending}>
            {t("decision.cancel")}
          </Button>
          <Button type="button" variant="destructive" size="sm" onClick={() => decide("REJECTED")} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} {t("decision.confirmReject")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setRejecting(true)} disabled={pending}>
          <X className="size-4" /> {t("decision.reject")}
        </Button>
        <Button size="sm" onClick={() => decide("APPROVED")} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} {t("decision.approve")}
        </Button>
      </div>
      {error ? <p role="alert" className="max-w-xs text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
