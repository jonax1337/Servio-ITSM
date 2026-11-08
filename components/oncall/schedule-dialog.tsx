"use client";

import { useState } from "react";
import { PhoneCall, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ScheduleForm, type GroupOption, type PersonOption, type ScheduleFormValues } from "./schedule-form";
import { useT } from "@/lib/i18n/client";

/** Edit an existing on-call schedule in a dialog. MANAGER+ only (the action re-checks). */
export function EditScheduleDialog({
  scheduleId, initial, groups, agents,
}: { scheduleId: string; initial: ScheduleFormValues; groups: GroupOption[]; agents: PersonOption[] }) {
  const [open, setOpen] = useState(false);
  const t = useT("oncall");
  const tc = useT("common");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <Pencil className="size-4" /> {tc("edit")}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PhoneCall className="size-4 text-primary" /> {t("editSchedule")}
          </DialogTitle>
          <DialogDescription>{t("editScheduleDescription")}</DialogDescription>
        </DialogHeader>
        <ScheduleForm
          initial={initial}
          scheduleId={scheduleId}
          groups={groups}
          agents={agents}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
