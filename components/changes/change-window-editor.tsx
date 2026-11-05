"use client";

import { useTransition } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { updateChangeWindow } from "@/lib/actions/changes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DATETIME_LOCAL = "yyyy-MM-dd'T'HH:mm";

function toInputValue(date: Date | null) {
  return date ? format(date, DATETIME_LOCAL) : "";
}

/** Edits the planned maintenance window; the server rejects an end that is not after the start. */
export function ChangeWindowEditor({
  changeId, plannedStart, plannedEnd,
}: {
  changeId: number;
  plannedStart: Date | null;
  plannedEnd: Date | null;
}) {
  const [pending, start] = useTransition();

  const save = (formData: FormData) =>
    start(async () => {
      const res = await updateChangeWindow(formData);
      if (res.ok) toast.success("Planned window updated");
      else toast.error(res.error ?? "Could not update the planned window.");
    });

  return (
    <form action={save} className="grid gap-2">
      <input type="hidden" name="id" value={changeId} />
      <label className="grid gap-1 text-xs text-muted-foreground">
        Planned start
        <Input type="datetime-local" name="plannedStart" defaultValue={toInputValue(plannedStart)} />
      </label>
      <label className="grid gap-1 text-xs text-muted-foreground">
        Planned end
        <Input type="datetime-local" name="plannedEnd" defaultValue={toInputValue(plannedEnd)} />
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending} className="justify-self-start">
        Save window
      </Button>
    </form>
  );
}
