"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { createFreezeWindow, updateFreezeWindow } from "@/lib/actions/change-freeze";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ComboField } from "@/components/combo-field";

const DATETIME_LOCAL = "yyyy-MM-dd'T'HH:mm";

type ScopeOption = { value: string; label: string };

export type EditableFreeze = {
  id: string;
  name: string;
  reason: string | null;
  startsAt: Date;
  endsAt: Date;
  serviceId: string | null;
  groupId: string | null;
};

/** Create (no `freeze`) or edit a change freeze window; scopes are optional, none means "all changes". */
export function FreezeWindowDialog({
  freeze, services, teams,
}: {
  freeze?: EditableFreeze;
  services: ScopeOption[];
  teams: ScopeOption[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const isEdit = freeze !== undefined;

  const onSubmit = useFormSubmit(async (formData) => {
    setPending(true);
    const res = isEdit ? await updateFreezeWindow(formData) : await createFreezeWindow(formData);
    setPending(false);
    if (res.ok) {
      toast.success(isEdit ? "Freeze window updated" : "Freeze window created");
      setOpen(false);
    } else {
      toast.error(res.error ?? "Could not save the freeze window.");
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button variant="outline" size="icon-sm" aria-label={`Edit ${freeze.name}`} />
          ) : (
            <Button />
          )
        }
      >
        {isEdit ? <Pencil className="size-4" /> : <><Plus className="size-4" /> New freeze window</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit freeze window" : "New freeze window"}</DialogTitle>
          <DialogDescription>
            Changes planned inside a freeze cannot be submitted or rescheduled, except emergency changes with a justification.
          </DialogDescription>
        </DialogHeader>
        <form method="post" onSubmit={onSubmit} className="grid gap-3">
          {isEdit ? <input type="hidden" name="id" value={freeze.id} /> : null}
          <label className="grid gap-1 text-xs text-muted-foreground">
            Name
            <Input name="name" required defaultValue={freeze?.name} placeholder="Year-end freeze" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Reason
            <Textarea name="reason" defaultValue={freeze?.reason ?? ""} placeholder="Optional: why changes are paused" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
              Starts
              <Input type="datetime-local" name="startsAt" required defaultValue={freeze ? format(freeze.startsAt, DATETIME_LOCAL) : ""} />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Ends
              <Input type="datetime-local" name="endsAt" required defaultValue={freeze ? format(freeze.endsAt, DATETIME_LOCAL) : ""} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1 text-xs text-muted-foreground">
              Service
              <ComboField name="serviceId" options={services} defaultValue={freeze?.serviceId ?? "none"} includeNone noneLabel="All services" />
            </div>
            <div className="grid gap-1 text-xs text-muted-foreground">
              Team
              <ComboField name="groupId" options={teams} defaultValue={freeze?.groupId ?? "none"} includeNone noneLabel="All teams" />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {isEdit ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
