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
import { useServerMessage, useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";

const DATETIME_LOCAL = "yyyy-MM-dd'T'HH:mm";
const DEFAULT_DURATION_MINUTES = 15;
const DEFAULT_ANNOUNCE_HOURS = 24;
const DEFAULT_START_LEAD_HOURS = 2;

type StartMode = "now" | "later";

export type WindowTarget = { kind: "GENERAL" } | { kind: "UPDATE"; version: string };

function defaultsFor(target: WindowTarget, t: Translator<"maintenance">) {
  if (target.kind === "UPDATE") {
    return {
      title: t("updateTo", { version: target.version }),
      message: t("updateMessage", { version: target.version }),
    };
  }
  return { title: t("plannedMaintenance"), message: t("plannedMessage") };
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
  const t = useT("maintenance");
  const tc = useT("common");
  const tm = useServerMessage();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [startMode, setStartMode] = useState<StartMode>("later");
  const [startsAt, setStartsAt] = useState("");
  const defaults = defaultsFor(target, t);
  const isUpdate = target.kind === "UPDATE";

  const onSubmit = useFormSubmit(async (formData) => {
    setPending(true);
    const res = await scheduleMaintenance(withIsoStart(formData));
    setPending(false);
    if (res.ok) {
      toast.success(startMode === "now" ? t("maintenanceStarted") : t("maintenanceScheduled"));
      setOpen(false);
    } else {
      toast.error(res.error ? tm(res.error) : t("scheduleFailed"));
    }
  });

  // The default start is "two hours from now" at the moment the dialog opens, not at page load.
  const onOpenChange = (next: boolean) => {
    if (next) setStartsAt(format(addHours(new Date(), DEFAULT_START_LEAD_HOURS), DATETIME_LOCAL));
    setOpen(next);
  };

  const label = isUpdate ? t("scheduleUpdate") : t("planMaintenance");
  const Icon = isUpdate ? CalendarPlus : Wrench;
  if (disabledReason) {
    return (
      <Button variant="outline" size={isUpdate ? "sm" : "default"} disabled title={tm(disabledReason)}>
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
          <DialogTitle>{isUpdate ? t("scheduleUpdateTo", { version: target.version }) : t("planMaintenance")}</DialogTitle>
          <DialogDescription>
            {t("dialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <form method="post" onSubmit={onSubmit} className="grid gap-3">
          <input type="hidden" name="kind" value={target.kind} />
          {isUpdate ? <input type="hidden" name="targetVersion" value={target.version} /> : null}
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("title")}
            <Input name="title" required defaultValue={defaults.title} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("messageToUsers")}
            <Textarea name="message" defaultValue={defaults.message} />
          </label>
          <fieldset className="grid gap-2 text-xs text-muted-foreground">
            <legend className="mb-1">{t("start")}</legend>
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
                  {mode === "now" ? t("rightNow") : t("atSetTime")}
                </label>
              ))}
            </div>
            {startMode === "later" ? (
              <Input type="datetime-local" name="startsAt" required defaultValue={startsAt} aria-label={t("startDateTime")} />
            ) : null}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("duration")}
              <Input type="number" name="durationMinutes" min={1} max={1440} required defaultValue={DEFAULT_DURATION_MINUTES} />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("announce")}
              <Input type="number" name="announceHours" min={0} max={336} required defaultValue={DEFAULT_ANNOUNCE_HOURS} />
            </label>
          </div>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              {t("blockAccess")}
              <span className="block text-xs text-muted-foreground">{t("blockAccessHint")}</span>
            </span>
            <Switch name="blockAccess" defaultChecked />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {startMode === "now" ? t("startNow") : t("schedule")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
