"use client";

import { useState, useTransition } from "react";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateChangeField } from "@/lib/actions/changes";
import { cancelReasonError } from "@/lib/change-rules";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/** Header action that opens the cancellation dialog. */
export function CancelChangeButton({ changeId }: { changeId: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Ban className="size-3.5" /> Cancel change
      </Button>
      <CancelChangeDialog changeId={changeId} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** Asks for the reason, then cancels the change; pending approval requests are withdrawn server-side. */
export function CancelChangeDialog({
  changeId, open, onOpenChange,
}: {
  changeId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Inner form only mounts while open, so its state resets on every open. */}
        {open ? <CancelForm changeId={changeId} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CancelForm({ changeId, onClose }: { changeId: number; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const problem = cancelReasonError(reason);

  const confirm = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", String(changeId));
      fd.set("field", "status");
      fd.set("value", "CANCELLED");
      fd.set("cancelReason", reason);
      const res = await updateChangeField(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Change cancelled");
      onClose();
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Cancel change</DialogTitle>
        <DialogDescription>
          The change is withdrawn and becomes read-only. Approval requests that are still pending are withdrawn too.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor="cancel-reason">Reason</Label>
        <Textarea
          id="cancel-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this change being cancelled?"
          rows={4}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Keep change</Button>
        <Button type="button" variant="destructive" onClick={confirm} disabled={pending || !!problem}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          Cancel change
        </Button>
      </DialogFooter>
    </>
  );
}
