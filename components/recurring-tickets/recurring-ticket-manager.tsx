"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Loader2, Pencil, Play, Plus, Repeat, Save, Trash2 } from "lucide-react";
import {
  createRecurringTicket,
  deleteRecurringTicket,
  runRecurringTicketNow,
  setRecurringTicketActive,
  updateRecurringTicket,
  type RecurringTicketState,
} from "@/lib/actions/recurring-tickets";
import {
  IMPACT_URGENCY,
  LEVEL_META,
  PRIORITIES,
  PRIORITY_META,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_FREQUENCY_META,
  TICKET_TYPES,
  TICKET_TYPE_META,
  type RecurrenceFrequency,
} from "@/lib/constants";
import { isValidTimeZone, parseZonedDateTime } from "@/lib/oncall-rules";
import {
  creationTimeFor,
  describeRecurrence,
  initialNextDue,
  leadTimeError,
  occurrenceAt,
  openOccurrencesAtOnce,
  indexOnOrAfter,
  type Recurrence,
} from "@/lib/recurring-ticket-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Combobox, type ComboOption } from "@/components/combobox";
import { ComboField } from "@/components/combo-field";
import { ConfirmButton } from "@/components/confirm-dialog";
import { StatusBadge } from "@/components/status-badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export type Opt = { value: string; label: string; hint?: string };

export type RecurringTicketListRow = {
  id: string;
  name: string;
  isActive: boolean;
  title: string;
  description: string;
  type: string;
  priority: string;
  impact: string;
  urgency: string;
  requesterId: string | null;
  assigneeId: string | null;
  groupId: string | null;
  groupName: string | null;
  categoryId: string | null;
  serviceId: string | null;
  frequency: RecurrenceFrequency;
  interval: number;
  timezone: string;
  /** "YYYY-MM-DD" in `timezone`. */
  firstDueDate: string;
  /** "HH:mm" in `timezone`. */
  dueTime: string;
  createBeforeDays: number;
  nextDueLabel: string;
  nextCreateLabel: string;
  lastCreatedLabel: string | null;
  lastTicketId: number | null;
  lastTicketRef: string | null;
  lastError: string | null;
};

type Pickers = { requesters: Opt[]; agents: Opt[]; groups: Opt[]; categories: Opt[]; services: Opt[] };

const STATE_META = {
  ACTIVE: { label: "Active", tone: "success" as const },
  PAUSED: { label: "Paused", tone: "neutral" as const },
};

const TIME_ZONE_LIST_ID = "recurring-time-zones";

const enumOpts = (values: readonly string[], meta: Record<string, { label: string; tone?: ComboOption["tone"]; icon?: ComboOption["icon"] }>): ComboOption[] =>
  values.map((v) => ({ value: v, label: meta[v]?.label ?? v, tone: meta[v]?.tone, icon: meta[v]?.icon }));

const TYPE_OPTS = enumOpts(TICKET_TYPES, TICKET_TYPE_META);
const PRIORITY_OPTS = enumOpts(PRIORITIES, PRIORITY_META);
const LEVEL_OPTS = enumOpts(IMPACT_URGENCY, LEVEL_META);
const FREQUENCY_OPTS = enumOpts(RECURRENCE_FREQUENCIES, RECURRENCE_FREQUENCY_META);

function Field({
  label, htmlFor, error, hint, children,
}: { label: string; htmlFor?: string; error?: string[]; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{error[0]}</p> : null}
    </div>
  );
}

const subscribeNever = () => () => {};

function formatIn(instant: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(instant);
}

/** The next few occurrences of the schedule being edited, with the day each ticket appears. */
function SchedulePreview({ rule }: { rule: Recurrence | null }) {
  // Rendered after mount only: "next" depends on the viewer's clock.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  if (!rule || !mounted) return null;
  const now = new Date();
  const first = indexOnOrAfter(rule, initialNextDue(rule, now, null));
  const rows = [0, 1, 2].map((i) => {
    const due = occurrenceAt(rule, first + i);
    return { due: formatIn(due, rule.timezone), created: formatIn(creationTimeFor(rule, due), rule.timezone) };
  });
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-xs">
      <p className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground">
        <CalendarClock className="size-3.5 text-primary" /> Next occurrences
      </p>
      <ul className="grid gap-1 text-muted-foreground">
        {rows.map((r) => (
          <li key={r.due}>
            Due <span className="font-medium text-foreground">{r.due}</span>
            {rule.createBeforeDays > 0 ? <> · ticket created {r.created}</> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecurringTicketDialog({
  row, currentUserId, pickers,
}: { row?: RecurringTicketListRow; currentUserId: string; pickers: Pickers }) {
  const editing = !!row;
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [state, setState] = useState<RecurringTicketState>(undefined);
  const [pending, startTransition] = useTransition();
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(row?.frequency ?? "MONTHLY");
  const [interval, setIntervalText] = useState(String(row?.interval ?? 1));
  const [typedTimezone, setTimezone] = useState<string | null>(null);
  const [typedDate, setDate] = useState<string | null>(null);
  const [dueTime, setDueTime] = useState(row?.dueTime ?? "09:00");
  const [leadDays, setLeadDays] = useState(String(row?.createBeforeDays ?? 0));
  const [isActive, setIsActive] = useState(row?.isActive ?? true);
  const fe = state?.fieldErrors ?? {};

  // A new schedule starts in the viewer's own zone and on tomorrow's date (client-side, after mount).
  const browserTimezone = useSyncExternalStore(subscribeNever, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => "UTC");
  const tomorrow = useSyncExternalStore(
    subscribeNever,
    () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    () => "",
  );
  const timezone = typedTimezone ?? row?.timezone ?? browserTimezone;
  const firstDueDate = typedDate ?? row?.firstDueDate ?? tomorrow;
  const zones = useMemo(() => ["UTC", ...Intl.supportedValuesOf("timeZone")], []);

  const intervalNum = Number(interval);
  const leadNum = Number(leadDays);
  const validNumbers = Number.isInteger(intervalNum) && intervalNum >= 1 && Number.isInteger(leadNum) && leadNum >= 0;
  const leadHint = validNumbers ? leadTimeError(frequency, intervalNum, leadNum) : null;
  const openAtOnce = validNumbers && !leadHint ? openOccurrencesAtOnce(frequency, intervalNum, leadNum) : 1;
  const firstDueAt = isValidTimeZone(timezone) ? parseZonedDateTime(`${firstDueDate}T${dueTime}`, timezone) : new Date(Number.NaN);
  const rule: Recurrence | null =
    validNumbers && !leadHint && !Number.isNaN(firstDueAt.getTime())
      ? { frequency, interval: intervalNum, timezone, firstDueAt, createBeforeDays: leadNum }
      : null;

  const reset = () => {
    setFrequency(row?.frequency ?? "MONTHLY");
    setIntervalText(String(row?.interval ?? 1));
    setTimezone(null);
    setDate(null);
    setDueTime(row?.dueTime ?? "09:00");
    setLeadDays(String(row?.createBeforeDays ?? 0));
    setIsActive(row?.isActive ?? true);
    setState(undefined);
    setFormKey((k) => k + 1);
  };

  const submit = (formData: FormData) => {
    formData.set("frequency", frequency);
    formData.set("firstDueAt", `${firstDueDate}T${dueTime}`);
    formData.set("isActive", String(isActive));
    startTransition(async () => {
      const res = await (editing ? updateRecurringTicket : createRecurringTicket)(undefined, formData);
      setState(res);
      if (res?.ok) {
        setOpen(false);
        toast.success(editing ? "Recurring ticket saved." : "Recurring ticket created.");
      }
    });
  };

  const agentOpts: ComboOption[] = pickers.agents.map((a) => ({ ...a, avatar: (a.label || "?").slice(0, 2) }));
  const requesterOpts: ComboOption[] = pickers.requesters.map((u) => ({ ...u, avatar: (u.label || "?").slice(0, 2) }));
  const requesterDefault = row ? row.requesterId ?? "none" : pickers.requesters.some((r) => r.value === currentUserId) ? currentUserId : "none";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) reset();
      }}
    >
      <DialogTrigger
        render={<Button variant={editing ? "outline" : "default"} size={editing ? "icon-sm" : "default"} aria-label={editing ? "Edit recurring ticket" : undefined} />}
      >
        {editing ? <Pencil className="size-4" /> : <><Plus className="size-4" /> New recurring ticket</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="size-4 text-primary" /> {editing ? "Edit recurring ticket" : "New recurring ticket"}
          </DialogTitle>
          <DialogDescription>A ticket template plus a schedule. Each occurrence creates one ticket.</DialogDescription>
        </DialogHeader>

        <form key={formKey} action={submit} className="grid max-h-[70vh] gap-4 overflow-y-auto px-0.5">
          {editing ? <input type="hidden" name="id" value={row.id} /> : null}

          {state?.error ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
          ) : null}

          <Field label="Name" htmlFor="rt-name" error={fe.name} hint="Shown in this list only.">
            <Input id="rt-name" name="name" defaultValue={row?.name} placeholder="e.g. Wildcard certificate renewal" required />
          </Field>

          <fieldset className="grid gap-4 rounded-lg border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Ticket</legend>
            <Field label="Title" htmlFor="rt-title" error={fe.title}>
              <Input id="rt-title" name="title" defaultValue={row?.title} placeholder="e.g. Renew *.example.org certificate" required />
            </Field>
            <Field label="Description" htmlFor="rt-description" error={fe.description}>
              <Textarea id="rt-description" name="description" defaultValue={row?.description ?? ""} className="min-h-20" placeholder="Steps, links, who to inform…" />
            </Field>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field label="Type" error={fe.type}>
                <ComboField name="type" options={TYPE_OPTS} defaultValue={row?.type ?? "REQUEST"} />
              </Field>
              <Field label="Priority" error={fe.priority}>
                <ComboField name="priority" options={PRIORITY_OPTS} defaultValue={row?.priority ?? "MEDIUM"} />
              </Field>
              <Field label="Impact" error={fe.impact}>
                <ComboField name="impact" options={LEVEL_OPTS} defaultValue={row?.impact ?? "MEDIUM"} />
              </Field>
              <Field label="Urgency" error={fe.urgency}>
                <ComboField name="urgency" options={LEVEL_OPTS} defaultValue={row?.urgency ?? "MEDIUM"} />
              </Field>
              <Field label="Requester" error={fe.requesterId} hint="Who the ticket is for. None = whoever created this schedule.">
                <ComboField name="requesterId" options={requesterOpts} defaultValue={requesterDefault} includeNone noneLabel="— Schedule creator —" />
              </Field>
              <Field label="Assignee" error={fe.assigneeId}>
                <ComboField name="assigneeId" options={agentOpts} defaultValue={row?.assigneeId ?? "none"} includeNone noneLabel="— Unassigned —" />
              </Field>
              <Field label="Group" error={fe.groupId}>
                <ComboField name="groupId" options={pickers.groups} defaultValue={row?.groupId ?? "none"} includeNone noneLabel="— No group —" />
              </Field>
              <Field label="Category" error={fe.categoryId}>
                <ComboField name="categoryId" options={pickers.categories} defaultValue={row?.categoryId ?? "none"} includeNone />
              </Field>
              <Field label="Service" error={fe.serviceId}>
                <ComboField name="serviceId" options={pickers.services} defaultValue={row?.serviceId ?? "none"} includeNone />
              </Field>
            </div>
          </fieldset>

          <fieldset className="grid gap-4 rounded-lg border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Schedule</legend>
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <Field label="Repeats" error={fe.frequency}>
                <Combobox options={FREQUENCY_OPTS} value={frequency} onChange={(v) => setFrequency((v || "MONTHLY") as RecurrenceFrequency)} />
              </Field>
              <Field label="Every" htmlFor="rt-interval" error={fe.interval} hint={validNumbers ? describeRecurrence(frequency, intervalNum) : undefined}>
                <Input id="rt-interval" name="interval" type="number" min={1} max={365} required value={interval} onChange={(e) => setIntervalText(e.target.value)} />
              </Field>
            </div>
            <div className="grid items-start gap-4 sm:grid-cols-3">
              <Field label="First due date" htmlFor="rt-date" error={fe.firstDueAt}>
                <Input id="rt-date" type="date" required value={firstDueDate} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Due time" htmlFor="rt-time">
                <Input id="rt-time" type="time" required value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
              </Field>
              <Field label="Time zone" htmlFor="rt-timezone" error={fe.timezone}>
                <Input id="rt-timezone" name="timezone" list={TIME_ZONE_LIST_ID} required value={timezone} onChange={(e) => setTimezone(e.target.value)} />
                <datalist id={TIME_ZONE_LIST_ID}>{zones.map((z) => <option key={z} value={z} />)}</datalist>
              </Field>
            </div>
            <Field
              label="Create the ticket … days before it is due"
              htmlFor="rt-lead"
              error={fe.createBeforeDays ?? (leadHint ? [leadHint] : undefined)}
              hint={
                openAtOnce > 1
                  ? `Longer than one step: up to ${openAtOnce} upcoming tickets exist at the same time, each created ${leadNum} days before its due date.`
                  : "0 = on the due date itself. Monthly dates past the 28th move to the month's last day when a month is shorter."
              }
            >
              <Input id="rt-lead" name="createBeforeDays" type="number" min={0} max={365} required value={leadDays} onChange={(e) => setLeadDays(e.target.value)} />
            </Field>
            <SchedulePreview rule={rule} />
          </fieldset>

          <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
            <span>
              Active
              <span className="block text-xs text-muted-foreground">Paused schedules create nothing; resuming skips occurrences that fell due meanwhile.</span>
            </span>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </label>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editing ? "Save changes" : "Create recurring ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ActiveToggle({ row }: { row: RecurringTicketListRow }) {
  const [pending, startTransition] = useTransition();
  const toggle = (active: boolean) => {
    const fd = new FormData();
    fd.set("id", row.id);
    fd.set("active", String(active));
    startTransition(async () => {
      const res = await setRecurringTicketActive(fd);
      if (!res.ok) toast.error(res.error ?? "Could not change the schedule.");
      else toast.success(active ? `Resumed "${row.name}".` : `Paused "${row.name}".`);
    });
  };
  return <Switch checked={row.isActive} disabled={pending} onCheckedChange={toggle} aria-label={row.isActive ? "Pause" : "Resume"} />;
}

function CreateNowButton({ row }: { row: RecurringTicketListRow }) {
  const [pending, startTransition] = useTransition();
  const run = () => {
    const fd = new FormData();
    fd.set("id", row.id);
    startTransition(async () => {
      const res = await runRecurringTicketNow(fd);
      if (!res.ok) toast.error(res.error ?? "The ticket could not be created.");
      else toast.success(`Created ${res.ref} for the next occurrence.`);
    });
  };
  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={run} title="Create the next occurrence's ticket right away">
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Create now
    </Button>
  );
}

export function RecurringTicketManager({
  rows, currentUserId, ...pickers
}: { rows: RecurringTicketListRow[]; currentUserId: string } & Pickers) {
  const active = rows.filter((r) => r.isActive).length;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {rows.length} schedule{rows.length === 1 ? "" : "s"} · {active} active
        </p>
        <RecurringTicketDialog currentUserId={currentUserId} pickers={pickers} />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No recurring tickets yet. Create one for routine work that must not be forgotten.
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg border text-primary">
                <Repeat className="size-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{r.name}</span>
                  <StatusBadge map={STATE_META} value={r.isActive ? "ACTIVE" : "PAUSED"} />
                  <StatusBadge map={TICKET_TYPE_META} value={r.type} />
                  <StatusBadge map={PRIORITY_META} value={r.priority} />
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {describeRecurrence(r.frequency, r.interval)} at {r.dueTime} ({r.timezone})
                  {r.createBeforeDays > 0 ? ` · created ${r.createBeforeDays} day${r.createBeforeDays === 1 ? "" : "s"} ahead` : ""}
                  {r.groupName ? ` · ${r.groupName}` : ""} · “{r.title}”
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                  <span className={r.isActive ? "text-foreground" : "text-muted-foreground"}>
                    Next due <span className="font-medium">{r.nextDueLabel}</span>
                    {r.isActive && r.createBeforeDays > 0 ? <span className="text-muted-foreground"> (ticket on {r.nextCreateLabel})</span> : null}
                  </span>
                  {r.lastCreatedLabel ? (
                    <span className="text-muted-foreground">
                      Last: {r.lastTicketId && r.lastTicketRef ? (
                        <Link href={`/tickets/${r.lastTicketId}`} className="font-medium text-primary hover:underline">{r.lastTicketRef}</Link>
                      ) : "no ticket"}{" "}
                      for {r.lastCreatedLabel}
                    </span>
                  ) : null}
                </div>
                {r.lastError ? (
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Last attempt failed: {r.lastError}
                  </p>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <ActiveToggle row={r} />
                <CreateNowButton row={r} />
                <RecurringTicketDialog row={r} currentUserId={currentUserId} pickers={pickers} />
                <ConfirmButton
                  action={deleteRecurringTicket}
                  fields={{ id: r.id }}
                  title="Delete recurring ticket?"
                  description={`"${r.name}" stops creating tickets. Tickets it already created stay. This can't be undone.`}
                  triggerLabel="Delete recurring ticket"
                  successMessage="Recurring ticket deleted."
                >
                  <Trash2 className="size-4" />
                </ConfirmButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
