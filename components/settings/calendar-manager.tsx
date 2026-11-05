"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2, Loader2, Save, CalendarDays, CalendarPlus } from "lucide-react";
import {
  createCalendar, updateCalendar, deleteCalendar, addHoliday, deleteHoliday,
  type SlaState,
} from "@/lib/actions/sla-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { ConfirmButton } from "@/components/confirm-dialog";
import { WEEKDAY_KEYS, type WeekdayKey } from "@/lib/business-hours";

export type CalendarRow = {
  id: string;
  name: string;
  timezone: string;
  weeklyHours: string; // JSON
  holidays: { id: string; name: string; date: Date | string }[];
};

const DAY_LABELS: Record<WeekdayKey, string> = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday",
};

type DayState = { enabled: boolean; open: string; close: string };

function parseWeekly(json: string): Record<WeekdayKey, DayState> {
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(json || "{}"); } catch { raw = {}; }
  const out = {} as Record<WeekdayKey, DayState>;
  for (const key of WEEKDAY_KEYS) {
    const entry = raw[key];
    const first = Array.isArray(entry) && Array.isArray(entry[0]) ? entry[0] : null;
    const isWeekday = key !== "sat" && key !== "sun";
    out[key] = first
      ? { enabled: true, open: String(first[0] ?? "09:00"), close: String(first[1] ?? "17:00") }
      : { enabled: false, open: isWeekday ? "09:00" : "09:00", close: "17:00" };
  }
  // Sensible default for a brand-new calendar: Mon–Fri 09–17.
  if (!json || json === "{}") {
    for (const key of WEEKDAY_KEYS) {
      const isWeekday = key !== "sat" && key !== "sun";
      out[key] = { enabled: isWeekday, open: "09:00", close: "17:00" };
    }
  }
  return out;
}

function serializeWeekly(days: Record<WeekdayKey, DayState>): string {
  const obj: Record<string, string[][]> = {};
  for (const key of WEEKDAY_KEYS) {
    const d = days[key];
    obj[key] = d.enabled ? [[d.open, d.close]] : [];
  }
  return JSON.stringify(obj);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function CalendarDialog({ calendar }: { calendar?: CalendarRow }) {
  const editing = !!calendar;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SlaState>(undefined);
  const [pending, startTransition] = useTransition();
  const [days, setDays] = useState<Record<WeekdayKey, DayState>>(() => parseWeekly(calendar?.weeklyHours ?? ""));

  const submit = (formData: FormData) => {
    formData.set("weeklyHours", serializeWeekly(days));
    startTransition(async () => {
      const res = await (editing ? updateCalendar : createCalendar)(undefined, formData);
      setState(res);
      if (!res || res.ok) setOpen(false);
    });
  };

  const setDay = (key: WeekdayKey, patch: Partial<DayState>) =>
    setDays((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={editing ? "outline" : "default"} size={editing ? "icon-sm" : "default"} aria-label={editing ? "Edit calendar" : undefined} />}>
        {editing ? <Pencil className="size-4" /> : <><Plus className="size-4" /> New calendar</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarDays className="size-4 text-primary" /> {editing ? "Edit calendar" : "New calendar"}</DialogTitle>
          <DialogDescription>Working hours drive SLA deadlines: only time inside an open window (and not on a holiday) counts against the clock.</DialogDescription>
        </DialogHeader>

        <form action={submit} className="grid gap-4">
          {editing ? <input type="hidden" name="id" value={calendar.id} /> : null}

          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Name">
              <Input name="name" defaultValue={calendar?.name} placeholder="e.g. Business hours" required />
            </Field>
            <Field label="Timezone">
              <Input name="timezone" defaultValue={calendar?.timezone ?? "UTC"} placeholder="e.g. Europe/Berlin" required />
            </Field>
          </div>

          <div className="grid gap-1.5">
            <Label>Weekly hours</Label>
            <div className="divide-y rounded-lg border">
              {WEEKDAY_KEYS.map((key) => {
                const d = days[key];
                return (
                  <div key={key} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <Switch checked={d.enabled} onCheckedChange={(v) => setDay(key, { enabled: v })} />
                    <span className="w-20 text-muted-foreground">{DAY_LABELS[key]}</span>
                    {d.enabled ? (
                      <div className="ml-auto flex items-center gap-2">
                        <Input type="time" value={d.open} onChange={(e) => setDay(key, { open: e.target.value })} className="h-8 w-28" />
                        <span className="text-muted-foreground">–</span>
                        <Input type="time" value={d.close} onChange={(e) => setDay(key, { close: e.target.value })} className="h-8 w-28" />
                      </div>
                    ) : (
                      <span className="ml-auto text-xs text-muted-foreground">Closed</span>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Times are wall-clock in the calendar’s timezone.</p>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editing ? "Save calendar" : "Create calendar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HolidayDialog({ calendarId }: { calendarId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SlaState>(undefined);
  const [pending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    startTransition(async () => {
      const res = await addHoliday(undefined, formData);
      setState(res);
      if (!res || res.ok) setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <CalendarPlus className="size-4" /> Add holiday
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add holiday</DialogTitle>
          <DialogDescription>A whole closed day — the SLA clock pauses on it.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <input type="hidden" name="calendarId" value={calendarId} />
          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
          ) : null}
          <Field label="Name">
            <Input name="name" placeholder="e.g. New Year’s Day" required />
          </Field>
          <Field label="Date">
            <Input name="date" type="date" required />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function summarizeWeek(json: string): string {
  const days = parseWeekly(json);
  const openDays = WEEKDAY_KEYS.filter((k) => days[k].enabled);
  if (openDays.length === 0) return "No open hours";
  return `${openDays.length} open day${openDays.length === 1 ? "" : "s"}`;
}

export function CalendarManager({ calendars }: { calendars: CalendarRow[] }) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {calendars.length} calendar{calendars.length === 1 ? "" : "s"} · working hours + holidays used by SLA deadlines.
        </p>
        <CalendarDialog />
      </div>

      {calendars.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No calendars yet. Create one to make SLAs honour working hours instead of running 24/7.
        </div>
      ) : (
        <div className="grid gap-3">
          {calendars.map((c) => (
            <div key={c.id} className="rounded-xl border">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid size-9 place-items-center rounded-lg border text-primary"><CalendarDays className="size-4.5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.timezone} · {summarizeWeek(c.weeklyHours)}</div>
                </div>
                <CalendarDialog calendar={c} />
                <ConfirmButton
                  action={deleteCalendar}
                  fields={{ id: c.id }}
                  title="Delete calendar?"
                  description={`"${c.name}" will be removed and unlinked from any SLAs (they revert to 24/7). This can't be undone.`}
                  triggerLabel="Delete calendar"
                >
                  <Trash2 className="size-4" />
                </ConfirmButton>
              </div>

              <div className="border-t px-4 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Holidays ({c.holidays.length})</span>
                  <HolidayDialog calendarId={c.id} />
                </div>
                {c.holidays.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No holidays.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {c.holidays.map((h) => (
                      <li key={h.id} className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
                        <span className="font-medium">{h.name}</span>
                        <span className="text-muted-foreground">{new Date(h.date).toISOString().slice(0, 10)}</span>
                        <ConfirmButton
                          action={deleteHoliday}
                          fields={{ id: h.id }}
                          title="Remove holiday?"
                          description={`"${h.name}" will be removed from this calendar.`}
                          confirmLabel="Remove"
                          triggerVariant="ghost"
                          triggerSize="icon-xs"
                          triggerClassName="size-4 text-muted-foreground hover:text-destructive"
                          triggerLabel="Remove holiday"
                        >
                          <Trash2 className="size-3" />
                        </ConfirmButton>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
