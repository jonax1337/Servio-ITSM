"use client";

import { useState, useTransition } from "react";
import { CalendarDays, X } from "lucide-react";
import { setTicketDueDate } from "@/lib/actions/tickets";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { LocalTime, useHydrated } from "@/components/local-time";

export function DueDatePicker({ ticketId, dueDate }: { ticketId: number; dueDate: Date | null }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const submit = (d: Date | null) => {
    const fd = new FormData();
    fd.set("id", String(ticketId));
    fd.set("dueDate", d ? d.toISOString() : "");
    start(async () => {
      await setTicketDueDate(fd);
      setOpen(false);
    });
  };

  // Overdue depends on the viewer's clock, so it is decided after hydration (see LocalTime).
  const overdue = useHydrated() && dueDate !== null && dueDate < new Date();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            data-pending={pending ? "" : undefined}
            className="w-full justify-start gap-2 font-normal data-[pending]:opacity-70"
          />
        }
      >
        <CalendarDays className={cn("size-4", overdue ? "text-destructive" : "text-muted-foreground")} />
        {dueDate ? (
          <span className={overdue ? "font-medium text-destructive" : undefined}><LocalTime date={dueDate} render={(d) => format(d, "PP")} /></span>
        ) : (
          <span className="text-muted-foreground">Set due date…</span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={dueDate ?? undefined} onSelect={(d) => submit(d ?? null)} autoFocus />
        {dueDate ? (
          <div className="border-t p-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => submit(null)}>
              <X className="size-3.5" /> Clear due date
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
