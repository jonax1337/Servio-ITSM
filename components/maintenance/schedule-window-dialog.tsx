"use client";

import { useState } from "react";
import { addHours, format } from "date-fns";
import { CalendarPlus, Loader2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { scheduleMaintenance } from "@/lib/actions/maintenance";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const DATETIME_LOCAL = "yyyy-MM-dd'T'HH:mm";
const DEFAULT_DURATION_MINUTES = 15;
const DEFAULT_ANNOUNCE_HOURS = 24;
const DEFAULT_START_LEAD_HOURS = 2;

type StartMode = "now" | "later";

export type WindowTarget = { kind: "GENERAL" } | { kind: "UPDATE"; version: string };

function defaultsFor(target: WindowTarget) {
  if (target.kind === "UPDATE") {
    return {
      title: `Update to ${target.version}`,
      message: `Servio is being updated to ${target.version}. This takes a few minutes.`,
    };
  }
  return { title: "Planned maintenance", message: "We are carrying out planned maintenance." };
}

/** The browser's datetime-local value has no time zone; send the instant it means in the admin's zone. */
function withIsoStart(formData: FormData): FormData {
  const local = new Date(String(formData.get("startsAt") ?? ""));
  if (!Number.isNaN(local.getTime())) formData.set("startsAt", local.toISOString());
  return formData;
}

/** Plan a maintenance window (general downtime, or an update to `target.version`) that starts now or later. */
export function ScheduleWindowDialog({
  target,
  disabledReason,
}: {
  target: WindowTarget;
  /** Why scheduling is not possible right now (e.g. no updater); shown instead of opening the dialog. */
  disabledReason?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [startMode, setStartMode] = useState<StartMode>("later");
  const [startsAt, setStartsAt] = useState("");
  const defaults = defaultsFor(target);
  const isUpdate = target.kind === "UPDATE";

  const onSubmit = useFormSubmit(async (formData) => {
    setPending(true);
    const res = await scheduleMaintenance(withIsoStart(formData));
    setPending(false);
    if (res.ok) {
      toast.success(startMode === "now" ? "Maintenance started" : "Maintenance scheduled");
      setOpen(false);
    } else {
      toast.error(res.error ?? "Could not schedule the maintenance window.");
    }
  });

  // The default start is "two hours from now" at the moment the dialog opens, not at page load.
  const onOpenChange = (next: boolean) => {
    if (next) setStartsAt(format(addHours(new Date(), DEFAULT_START_LEAD_HOURS), DATETIME_LOCAL));
    setOpen(next);
  };

  const label = isUpdate ? "Schedule update" : "Plan maintenance";
  const Icon = isUpdate ? CalendarPlus : Wrench;
  if (disabledReason) {
    return (
      <Button variant="outline" size={isUpdate ? "sm" : "default"} disabled title={disabledReason}>
        <Icon className="size-4" /> {label}
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant={isUpdate ? "default" : "outline"} size={isUpdate ? "sm" : "default"} />}>
        <Icon className="size-4" /> {label}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isUpdate ? `Schedule update to ${target.version}` : "Plan maintenance"}</DialogTitle>
          <DialogDescription>
            Users are warned ahead of time. While the window runs, non-admins see the maintenance page.
          </DialogDescription>
        </DialogHeader>
        <form method="post" onSubmit={onSubmit} className="grid gap-3">
          <input type="hidden" name="kind" value={target.kind} />
          {isUpdate ? <input type="hidden" name="targetVersion" value={target.version} /> : null}
          <label className="grid gap-1 text-xs text-muted-foreground">
            Title
            <Input name="title" required defaultValue={defaults.title} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Message to users
            <Textarea name="message" defaultValue={defaults.message} />
          </label>
          <fieldset className="grid gap-2 text-xs text-muted-foreground">
            <legend className="mb-1">Start</legend>
            <div className="flex flex-wrap items-center gap-4 text-sm text-foreground">
              {(["now", "later"] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="startMode"
                    value={mode}
                    checked={startMode === mode}
                    onChange={() => setStartMode(mode)}
                  />
                  {mode === "now" ? "Right now" : "At a set time"}
                </label>
              ))}
            </div>
            {startMode === "later" ? (
              <Input type="datetime-local" name="startsAt" required defaultValue={startsAt} aria-label="Start date and time" />
            ) : null}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
              Duration (minutes)
              <Input type="number" name="durationMinutes" min={1} max={1440} required defaultValue={DEFAULT_DURATION_MINUTES} />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Announce (hours ahead)
              <Input type="number" name="announceHours" min={0} max={336} required defaultValue={DEFAULT_ANNOUNCE_HOURS} />
            </label>
          </div>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              Block access for non-admins
              <span className="block text-xs text-muted-foreground">Users see the maintenance page while the window runs.</span>
            </span>
            <Switch name="blockAccess" defaultChecked />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {startMode === "now" ? "Start now" : "Schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
