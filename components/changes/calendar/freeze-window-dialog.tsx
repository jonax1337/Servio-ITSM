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
import { useServerMessage, useT } from "@/lib/i18n/client";

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
  const t = useT("changes");
  const tc = useT("common");
  const tm = useServerMessage();

  const onSubmit = useFormSubmit(async (formData) => {
    setPending(true);
    const res = isEdit ? await updateFreezeWindow(formData) : await createFreezeWindow(formData);
    setPending(false);
    if (res.ok) {
      toast.success(isEdit ? t("freeze.updated") : t("freeze.created"));
      setOpen(false);
    } else {
      toast.error(res.error ? tm(res.error) : t("freeze.saveFailed"));
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          isEdit ? (
            <Button variant="outline" size="icon-sm" aria-label={t("freeze.editLabel", { name: freeze.name })} />
          ) : (
            <Button />
          )
        }
      >
        {isEdit ? <Pencil className="size-4" /> : <><Plus className="size-4" /> {t("freeze.new")}</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("freeze.edit") : t("freeze.new")}</DialogTitle>
          <DialogDescription>{t("freeze.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <form method="post" onSubmit={onSubmit} className="grid gap-3">
          {isEdit ? <input type="hidden" name="id" value={freeze.id} /> : null}
          <label className="grid gap-1 text-xs text-muted-foreground">
            {tc("name")}
            <Input name="name" required defaultValue={freeze?.name} placeholder={t("freeze.namePlaceholder")} />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            {t("cancel.reason")}
            <Textarea name="reason" defaultValue={freeze?.reason ?? ""} placeholder={t("freeze.reasonPlaceholder")} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("freeze.starts")}
              <Input type="datetime-local" name="startsAt" required defaultValue={freeze ? format(freeze.startsAt, DATETIME_LOCAL) : ""} />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              {t("freeze.ends")}
              <Input type="datetime-local" name="endsAt" required defaultValue={freeze ? format(freeze.endsAt, DATETIME_LOCAL) : ""} />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1 text-xs text-muted-foreground">
              {tc("service")}
              <ComboField name="serviceId" options={services} defaultValue={freeze?.serviceId ?? "none"} includeNone noneLabel={t("freeze.allServices")} />
            </div>
            <div className="grid gap-1 text-xs text-muted-foreground">
              {t("calendar.team")}
              <ComboField name="groupId" options={teams} defaultValue={freeze?.groupId ?? "none"} includeNone noneLabel={t("calendar.allTeams")} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {isEdit ? tc("save") : tc("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
