"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, ShieldAlert, X } from "lucide-react";
import { toast } from "sonner";
import { decideApproval } from "@/lib/actions/changes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServerMessage, useT } from "@/lib/i18n/client";

export function ApprovalActions({
  approvalId,
  selfApproval,
}: {
  approvalId: string;
  /** Set when the decider requested or owns the change: the comment becomes a required justification. */
  selfApproval?: { settlesBoard: boolean };
}) {
  const [comment, setComment] = useState("");
  const justificationMissing = !!selfApproval && comment.trim() === "";
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const t = useT("changes");
  const tm = useServerMessage();

  function decide(decision: "APPROVED" | "REJECTED") {
    const fd = new FormData();
    fd.set("approvalId", approvalId);
    fd.set("decision", decision);
    if (comment.trim()) fd.set("comment", comment.trim());
    start(async () => {
      const res = await decideApproval(fd);
      if (!res.ok) {
        setError(res.error);
        toast.error(tm(res.error));
        return;
      }
      setError(null);
      setComment("");
      toast.success(decision === "APPROVED" ? t("approvalActions.approved") : t("approvalActions.rejected"));
    });
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {selfApproval ? (
        <p className="flex basis-full items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          {selfApproval.settlesBoard ? t("approvalActions.selfApprovalHintSettles") : t("approvalActions.selfApprovalHint")}
        </p>
      ) : null}
      <Input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={selfApproval ? t("approvalActions.justificationPlaceholder") : t("approvalActions.commentPlaceholder")}
        aria-required={selfApproval ? true : undefined}
        className="h-7 flex-1 min-w-40 text-xs"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={pending || justificationMissing}
        onClick={() => decide("APPROVED")}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
        {t("approvalActions.approve")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || justificationMissing}
        onClick={() => decide("REJECTED")}
      >
        <X className="size-3.5" /> {t("approvalActions.reject")}
      </Button>
      {error ? <p role="alert" className="basis-full text-xs text-destructive">{tm(error)}</p> : null}
    </div>
  );
}
