"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateChangeField } from "@/lib/actions/changes";
import { allowedOutcomes, closureError } from "@/lib/change-rules";
import { CHANGE_OUTCOME_META, CHANGE_STATUS_META } from "@/lib/constants";
import { Combobox, type ComboOption } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type ClosureDialogProps = {
  changeId: number;
  changeType: string;
  /** CLOSED or FAILED — the status the change is about to enter. */
  toStatus: string;
  /** Pre-filled when the change already carries an outcome/notes (e.g. FAILED, now being closed). */
  initialOutcome: string | null;
  initialNotes: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Captures the outcome and post-implementation review that closing or failing a change requires. */
export function ClosureDialog({ open, onOpenChange, ...form }: ClosureDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Inner form only mounts while open, so its state resets on every open. */}
        {open ? <ClosureForm {...form} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ClosureForm({
  changeId, changeType, toStatus, initialOutcome, initialNotes, onClose,
}: Omit<ClosureDialogProps, "open" | "onOpenChange"> & { onClose: () => void }) {
  const outcomes = allowedOutcomes(toStatus);
  const [outcome, setOutcome] = useState(
    initialOutcome && outcomes.includes(initialOutcome) ? initialOutcome : outcomes[0],
  );
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [pending, start] = useTransition();

  const outcomeOpts: ComboOption[] = outcomes.map((o) => ({
    value: o, label: CHANGE_OUTCOME_META[o].label, tone: CHANGE_OUTCOME_META[o].tone, icon: CHANGE_OUTCOME_META[o].icon,
  }));
  const problem = closureError({ toStatus, type: changeType, outcome, notes });
  const statusLabel = CHANGE_STATUS_META[toStatus]?.label ?? toStatus;

  const confirm = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", String(changeId));
      fd.set("field", "status");
      fd.set("value", toStatus);
      fd.set("outcome", outcome);
      fd.set("closureNotes", notes);
      const res = await updateChangeField(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Change moved to ${statusLabel}`);
      onClose();
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>{toStatus === "FAILED" ? "Mark change as failed" : "Close change"}</DialogTitle>
        <DialogDescription>
          {changeType === "EMERGENCY"
            ? "Emergency changes require a post-implementation review before they can be closed."
            : "Record how the change went and what was learned (post-implementation review)."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label>Outcome</Label>
          <Combobox options={outcomeOpts} value={outcome} onChange={setOutcome} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="closure-notes">Closure notes</Label>
          <Textarea
            id="closure-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What happened, what went well or badly, lessons learned…"
            rows={5}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={confirm} disabled={pending || !!problem} title={problem ?? undefined}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {toStatus === "FAILED" ? "Mark as failed" : "Close change"}
          </Button>
        </DialogFooter>
      </div>
    </>
  );
}
