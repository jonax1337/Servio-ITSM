"use client";

import { useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { submitChangeForApproval } from "@/lib/actions/changes";
import { submitBlockedMessage } from "@/lib/change-rules";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export function SubmitForApproval({
  changeId, isStandard, approverCount, missing,
}: {
  changeId: number;
  isStandard: boolean;
  approverCount: number;
  /** What the change still lacks before it can be submitted (see submitBlockers). */
  missing: string[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Set when an emergency change sits inside a change freeze and must say why it overrides it.
  const [freezeNotice, setFreezeNotice] = useState<string | null>(null);

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
    ? "This standard change follows its approved template — submitting moves it straight to Approved."
    : approverCount > 0
      ? "Approvers already added stay on the board; the rest are selected automatically by change type and risk."
      : "This requests a CAB decision. Approvers are selected automatically by change type and risk.";

  const submit = (justification: string) => {
    const formData = new FormData();
    formData.set("id", String(changeId));
    if (justification) formData.set("justification", justification);
    startTransition(async () => {
      const res = await submitChangeForApproval(formData);
      if (res.ok) {
        toast.success("Submitted for approval");
        setOpen(false);
      } else if (res.needsJustification) {
        setFreezeNotice(res.error);
      } else {
        toast.error(res.error);
        setOpen(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="default" size="sm" aria-label="Submit for approval" />}>
        <Send className="size-3.5" /> Submit for approval
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit(String(new FormData(event.currentTarget).get("justification") ?? "").trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>Submit for approval?</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {freezeNotice ? (
            <label className="grid gap-1.5 text-sm">
              <span className="text-amber-600 dark:text-amber-400">{freezeNotice}</span>
              <Textarea name="justification" required placeholder="Why can this emergency change not wait?" />
            </label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Submit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
