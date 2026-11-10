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
import { ComboField } from "@/components/combo-field";
import { HOLIDAY_REGIONS } from "@/lib/public-holidays";
import { ConfirmButton } from "@/components/confirm-dialog";
import { WEEKDAY_KEYS, type WeekdayKey } from "@/lib/business-hours";
import { useServerMessage, useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";

export type CalendarRow = {
  id: string;
  name: string;
  timezone: string;
  weeklyHours: string; // JSON
  holidayRegion: string | null;
  holidays: { id: string; name: string; date: Date | string; generated: boolean }[];
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
  const t = useT("settings");
  const tm = useServerMessage();
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
      <DialogTrigger render={<Button variant={editing ? "outline" : "default"} size={editing ? "icon-sm" : "default"} aria-label={editing ? t("cal.editCalendar") : undefined} />}>
        {editing ? <Pencil className="size-4" /> : <><Plus className="size-4" /> {t("cal.newCalendar")}</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarDays className="size-4 text-primary" /> {editing ? t("cal.editCalendar") : t("cal.newCalendar")}</DialogTitle>
          <DialogDescription>{t("cal.dialogDescription")}</DialogDescription>
        </DialogHeader>

        <form action={submit} className="grid gap-4">
          {editing ? <input type="hidden" name="id" value={calendar.id} /> : null}

          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{tm(state.error)}</p>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <Field label={t("cal.name")}>
              <Input name="name" defaultValue={calendar?.name} placeholder={t("cal.namePlaceholder")} required />
            </Field>
            <Field label={t("cal.timezone")}>
              <Input name="timezone" defaultValue={calendar?.timezone ?? "UTC"} placeholder={t("cal.timezonePlaceholder")} required />
            </Field>
          </div>

          <Field label={t("cal.holidayRegion")}>
            <ComboField
              name="holidayRegion"
              defaultValue={calendar?.holidayRegion ?? "none"}
              includeNone
              noneLabel={t("cal.regionNone")}
              options={HOLIDAY_REGIONS.map((code) => ({ value: code, label: t(`cal.region.${code}`) }))}
            />
            <p className="text-xs text-muted-foreground">{t("cal.regionHint")}</p>
          </Field>

          <div className="grid gap-1.5">
            <Label>{t("cal.weeklyHours")}</Label>
            <div className="divide-y rounded-lg border">
              {WEEKDAY_KEYS.map((key) => {
                const d = days[key];
                return (
                  <div key={key} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <Switch checked={d.enabled} onCheckedChange={(v) => setDay(key, { enabled: v })} />
                    <span className="w-20 text-muted-foreground">{t(`cal.day.${key}`)}</span>
                    {d.enabled ? (
                      <div className="ml-auto flex items-center gap-2">
                        <Input type="time" value={d.open} onChange={(e) => setDay(key, { open: e.target.value })} className="h-8 w-28" />
                        <span className="text-muted-foreground">–</span>
                        <Input type="time" value={d.close} onChange={(e) => setDay(key, { close: e.target.value })} className="h-8 w-28" />
                      </div>
                    ) : (
                      <span className="ml-auto text-xs text-muted-foreground">{t("cal.closed")}</span>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{t("cal.wallClockHint")}</p>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editing ? t("cal.saveCalendar") : t("cal.createCalendar")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HolidayDialog({ calendarId }: { calendarId: string }) {
  const t = useT("settings");
  const tm = useServerMessage();
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
        <CalendarPlus className="size-4" /> {t("cal.addHoliday")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("cal.addHoliday")}</DialogTitle>
          <DialogDescription>{t("cal.holidayDescription")}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="grid gap-4">
          <input type="hidden" name="calendarId" value={calendarId} />
          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{tm(state.error)}</p>
          ) : null}
          <Field label={t("cal.name")}>
            <Input name="name" placeholder={t("cal.holidayPlaceholder")} required />
          </Field>
          <Field label={t("cal.date")}>
            <Input name="date" type="date" required />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} {t("cal.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function summarizeWeek(json: string, t: Translator<"settings">): string {
  const days = parseWeekly(json);
  const openDays = WEEKDAY_KEYS.filter((k) => days[k].enabled);
  if (openDays.length === 0) return t("cal.noOpenHours");
  return t("cal.openDays", { count: openDays.length });
}

export function CalendarManager({ calendars }: { calendars: CalendarRow[] }) {
  const t = useT("settings");
  const dayOf = (d: Date | string) => new Date(d).toISOString().slice(0, 10);
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("cal.summary", { count: calendars.length })}
        </p>
        <CalendarDialog />
      </div>

      {calendars.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("cal.empty")}
        </div>
      ) : (
        <div className="grid gap-3">
          {calendars.map((c) => (
            <div key={c.id} className="rounded-xl border">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid size-9 place-items-center rounded-lg border text-primary"><CalendarDays className="size-4.5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.timezone} · {summarizeWeek(c.weeklyHours, t)}</div>
                </div>
                <CalendarDialog calendar={c} />
                <ConfirmButton
                  action={deleteCalendar}
                  fields={{ id: c.id }}
                  title={t("cal.deleteTitle")}
                  description={t("cal.deleteDescription", { name: c.name })}
                  triggerLabel={t("cal.deleteCalendar")}
                >
                  <Trash2 className="size-4" />
                </ConfirmButton>
              </div>

              <div className="border-t px-4 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">{t("cal.holidays", { count: c.holidays.filter((h) => !h.generated).length })}</span>
                  <HolidayDialog calendarId={c.id} />
                </div>
                {c.holidays.every((h) => h.generated) ? (
                  <p className="text-xs text-muted-foreground">{t("cal.noHolidays")}</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {c.holidays.filter((h) => !h.generated).map((h) => (
                      <li key={h.id} className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
                        <span className="font-medium">{h.name}</span>
                        <span className="text-muted-foreground">{dayOf(h.date)}</span>
                        <ConfirmButton
                          action={deleteHoliday}
                          fields={{ id: h.id }}
                          title={t("cal.removeHolidayTitle")}
                          description={t("cal.removeHolidayDescription", { name: h.name })}
                          confirmLabel={t("cal.remove")}
                          triggerVariant="ghost"
                          triggerSize="icon-xs"
                          triggerClassName="size-4 text-muted-foreground hover:text-destructive"
                          triggerLabel={t("cal.removeHoliday")}
                        >
                          <Trash2 className="size-3" />
                        </ConfirmButton>
                      </li>
                    ))}
                  </ul>
                )}
                {c.holidayRegion && c.holidays.some((h) => h.generated) ? (
                  <div className="mt-3 border-t pt-2">
                    <span className="text-xs font-medium text-muted-foreground" title={t("cal.generatedHint")}>
                      {t("cal.generatedHolidays", {
                        region: t(`cal.region.${c.holidayRegion as (typeof HOLIDAY_REGIONS)[number]}`),
                        count: c.holidays.filter((h) => h.generated).length,
                      })}
                    </span>
                    <ul className="mt-1 flex flex-wrap gap-2">
                      {c.holidays.filter((h) => h.generated).map((h) => (
                        <li key={h.id} title={t("cal.generated")} className="flex items-center gap-1.5 rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
                          <span className="font-medium">{h.name}</span>
                          <span>{dayOf(h.date)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
