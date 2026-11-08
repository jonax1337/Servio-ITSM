"use client";

import { useState, useTransition } from "react";
import { Clock, Plus, Loader2 } from "lucide-react";
import { addWorkLog, type WorkLogState } from "@/lib/actions/tickets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger,
} from "@/components/ui/popover";
import { useServerMessage, useT } from "@/lib/i18n/client";

export function LogTimePopover({ ticketId }: { ticketId: number }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<WorkLogState>(undefined);
  const [pending, startTransition] = useTransition();
  const t = useT("tickets");
  const tm = useServerMessage();

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const res = await addWorkLog(formData);
      setState(res);
      if (res?.ok) setOpen(false);
    });
  };

  return (
    <Popover open={open} onOpenChange={(o) => { if (!pending) setOpen(o); }}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="w-full" />}>
        <Plus className="size-3.5" /> {t("work.logTime")}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>{t("work.logTime")}</PopoverTitle>
        </PopoverHeader>
        {state?.error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
            {tm(state.error)}
          </p>
        ) : null}
        <form action={submit} className="grid gap-2.5">
          <input type="hidden" name="ticketId" value={ticketId} />
          <div className="grid gap-1.5">
            <label htmlFor="wl-minutes" className="text-xs font-medium text-muted-foreground">{t("work.minutes")}</label>
            <Input id="wl-minutes" name="minutes" type="number" min={1} step={1} placeholder={t("work.minutesPlaceholder")} required autoFocus />
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="wl-note" className="text-xs font-medium text-muted-foreground">{t("work.note")}</label>
            <Input id="wl-note" name="note" placeholder={t("work.notePlaceholder")} />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" name="billable" className="size-3.5 rounded border-input" /> {t("work.billable")}
          </label>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Clock className="size-3.5" />}
            {t("work.logTime")}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
