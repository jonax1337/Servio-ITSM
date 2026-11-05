"use client";

import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { updateChangeWindow } from "@/lib/actions/changes";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DATETIME_LOCAL = "yyyy-MM-dd'T'HH:mm";

function toInputValue(date: Date | null) {
  return date ? format(date, DATETIME_LOCAL) : "";
}

/**
 * Edits the planned maintenance window; the server rejects an end that is not after the start.
 * Once the change is approved, `requiresReason` asks why it is being rescheduled.
 */
export function ChangeWindowEditor({
  changeId, plannedStart, plannedEnd, requiresReason,
}: {
  changeId: number;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  requiresReason: boolean;
}) {
  const [pending, setPending] = useState(false);

  const onSubmit = useFormSubmit(async (formData) => {
    setPending(true);
    const res = await updateChangeWindow(formData);
    setPending(false);
    if (res.ok) toast.success("Planned window updated");
    else toast.error(res.error);
  });

  return (
    <form method="post" onSubmit={onSubmit} className="grid gap-2">
      <input type="hidden" name="id" value={changeId} />
      <label className="grid gap-1 text-xs text-muted-foreground">
        Planned start
        <Input type="datetime-local" name="plannedStart" defaultValue={toInputValue(plannedStart)} />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Planned end
        <Input type="datetime-local" name="plannedEnd" defaultValue={toInputValue(plannedEnd)} />
      </label>
      {requiresReason ? (
        <label className="grid gap-1 text-xs text-muted-foreground">
          Reason for rescheduling
          <Input name="reason" placeholder="Only needed when the dates change" />
        </label>
      ) : null}
      <Button type="submit" size="sm" variant="outline" disabled={pending} className="justify-self-start">
        {requiresReason ? "Reschedule" : "Save window"}
      </Button>
    </form>
  );
}
