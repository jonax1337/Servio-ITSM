"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { ArrowDown, ArrowUp, Loader2, Save, X } from "lucide-react";
import { createSchedule, updateSchedule, type OnCallFormState } from "@/lib/actions/oncall";
import { calendarDateIn } from "@/lib/oncall-rules";
import { ONCALL_ROTATION_META, ONCALL_ROTATION_TYPES, type OnCallRotationType } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Combobox, type ComboOption } from "@/components/combobox";
import { UserAvatar } from "@/components/user-avatar";
import { RotationPreview } from "./rotation-preview";

export type PersonOption = { id: string; name: string | null; email: string };
export type GroupOption = { id: string; name: string };

export type ScheduleFormValues = {
  name: string;
  description: string | null;
  groupId: string;
  timezone: string;
  rotationType: string;
  customIntervalHours: number | null;
  handoffTime: string;
  /** First handoff date, "YYYY-MM-DD" in the schedule's time zone. */
  startDate: string;
  isActive: boolean;
  /** Rotation member user ids in shift order. */
  memberIds: string[];
};

const DEFAULT_CUSTOM_HOURS = 12;
const TIME_ZONE_LIST_ID = "oncall-time-zones";

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

const personLabel = (p: PersonOption) => p.name ?? p.email;

function rotationHint(rotationType: string): string {
  if (rotationType === "CUSTOM") return "Each person is on call for the shift length below, then hands off to the next.";
  const unit = ONCALL_ROTATION_META[rotationType as OnCallRotationType]?.hours === 24 ? "day" : "week";
  return `Each person is on call for one ${unit}, then hands off to the next in the order below.`;
}

function RotationMembers({
  agents, value, onChange,
}: { agents: PersonOption[]; value: string[]; onChange: (ids: string[]) => void }) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const addable: ComboOption[] = agents
    .filter((a) => !value.includes(a.id))
    .map((a) => ({ value: a.id, label: personLabel(a), avatar: personLabel(a), hint: a.email }));

  const move = (index: number, delta: -1 | 1) => {
    const next = [...value];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  };

  return (
    <div className="grid gap-2">
      {value.map((id, index) => {
        const person = byId.get(id);
        return (
          <div key={id} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm">
            <span className="w-5 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
            <UserAvatar name={person?.name} email={person?.email} size="xs" />
            <span className="min-w-0 flex-1 truncate">{person ? personLabel(person) : id}</span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Move earlier" disabled={index === 0} onClick={() => move(index, -1)}>
              <ArrowUp className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Move later" disabled={index === value.length - 1} onClick={() => move(index, 1)}>
              <ArrowDown className="size-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Remove from rotation" onClick={() => onChange(value.filter((v) => v !== id))}>
              <X className="size-4" />
            </Button>
          </div>
        );
      })}
      <Combobox
        options={addable}
        value=""
        onChange={(id) => onChange([...value, id])}
        placeholder={value.length === 0 ? "Add the first person to the rotation…" : "Add another person…"}
        searchPlaceholder="Search agents…"
        emptyText="Everyone is already in the rotation."
      />
      {value.map((id) => <input key={id} type="hidden" name="memberIds" value={id} />)}
    </div>
  );
}

/** The on-call schedule form: creates a schedule, or edits one when `scheduleId` is given. MANAGER+ only; the actions re-check. */
export function ScheduleForm({
  initial, scheduleId, groups, agents, onSaved,
}: {
  initial: ScheduleFormValues;
  scheduleId?: string;
  groups: GroupOption[];
  agents: PersonOption[];
  onSaved?: () => void;
}) {
  const editing = !!scheduleId;
  const [state, setState] = useState<OnCallFormState>(undefined);
  const [pending, startTransition] = useTransition();
  const [groupId, setGroupId] = useState(initial.groupId);
  const [rotationType, setRotationType] = useState(initial.rotationType);
  const [customHours, setCustomHours] = useState(String(initial.customIntervalHours ?? DEFAULT_CUSTOM_HOURS));
  const [typedTimezone, setTimezone] = useState<string | null>(null);
  const [handoffTime, setHandoffTime] = useState(initial.handoffTime);
  const [typedStartDate, setStartDate] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>(initial.memberIds);
  const [isActive, setIsActive] = useState(initial.isActive);
  const fe = state?.fieldErrors ?? {};

  // A new schedule starts in the viewer's own zone; the server renders the initial zone and the client swaps it in.
  const browserTimezone = useSyncExternalStore(subscribeNever, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => initial.timezone);
  const timezone = typedTimezone ?? (editing ? initial.timezone : browserTimezone);
  // A new schedule's first handoff defaults to today in the chosen zone, until it is typed over.
  const startDate = typedStartDate ?? (editing ? initial.startDate : calendarDateIn(new Date(), timezone));

  const zones = useMemo(() => ["UTC", ...Intl.supportedValuesOf("timeZone")], []);
  const groupOpts: ComboOption[] = groups.map((g) => ({ value: g.id, label: g.name }));
  const rotationOpts: ComboOption[] = ONCALL_ROTATION_TYPES.map((t) => ({
    value: t, label: ONCALL_ROTATION_META[t].label, tone: ONCALL_ROTATION_META[t].tone,
  }));
  const byId = new Map(agents.map((a) => [a.id, a]));
  const rotationMembers = memberIds.flatMap((id) => byId.get(id) ?? []);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const res = await (editing ? updateSchedule : createSchedule)(undefined, formData);
      setState(res);
      if (res?.ok) onSaved?.();
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      {scheduleId ? <input type="hidden" name="id" value={scheduleId} /> : null}
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="rotationType" value={rotationType} />
      <input type="hidden" name="isActive" value={String(isActive)} />

      {state?.error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      ) : null}

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="oncall-name" error={fe.name}>
          <Input id="oncall-name" name="name" defaultValue={initial.name} placeholder="e.g. Primary on-call" required />
        </Field>
        <Field label="Team" error={fe.groupId} hint="Escalations for this team's tickets reach whoever is on call here.">
          <Combobox options={groupOpts} value={groupId} onChange={setGroupId} placeholder="Choose a team" />
        </Field>
      </div>

      <Field label="Description" htmlFor="oncall-description" error={fe.description}>
        <Textarea id="oncall-description" name="description" defaultValue={initial.description ?? ""} className="min-h-16" placeholder="Optional: what this rotation covers" />
      </Field>

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field label="Rotation" error={fe.rotationType} hint={rotationHint(rotationType)}>
          <Combobox options={rotationOpts} value={rotationType} onChange={setRotationType} />
        </Field>
        {rotationType === "CUSTOM" ? (
          <Field label="Shift length (hours)" htmlFor="oncall-hours" error={fe.customIntervalHours}>
            <Input
              id="oncall-hours" name="customIntervalHours" type="number" min={1} max={720} required
              value={customHours} onChange={(e) => setCustomHours(e.target.value)}
            />
          </Field>
        ) : null}
      </div>

      <div className="grid items-start gap-4 sm:grid-cols-3">
        <Field label="Time zone" htmlFor="oncall-timezone" error={fe.timezone}>
          <Input
            id="oncall-timezone" name="timezone" list={TIME_ZONE_LIST_ID} required
            value={timezone} onChange={(e) => setTimezone(e.target.value)}
          />
          <datalist id={TIME_ZONE_LIST_ID}>{zones.map((z) => <option key={z} value={z} />)}</datalist>
        </Field>
        <Field label="Handoff time" htmlFor="oncall-handoff" error={fe.handoffTime}>
          <Input id="oncall-handoff" name="handoffTime" type="time" required value={handoffTime} onChange={(e) => setHandoffTime(e.target.value)} />
        </Field>
        <Field label="First handoff" htmlFor="oncall-start" error={fe.startDate}>
          <Input id="oncall-start" name="startDate" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        The first person starts on the first handoff date at the handoff time, in the schedule&apos;s time zone. Nobody is on call before that.
      </p>

      <Field
        label="Rotation order"
        error={fe.memberIds}
        hint={editing ? "Changing the members or their order re-maps every shift from the first handoff." : "Shifts go to people in this order, then start over."}
      >
        <RotationMembers agents={agents} value={memberIds} onChange={setMemberIds} />
      </Field>

      <RotationPreview
        rotationType={rotationType}
        customIntervalHours={Number(customHours) || null}
        handoffTime={handoffTime}
        timezone={timezone}
        startDate={startDate}
        members={rotationMembers}
      />

      {editing ? (
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={isActive} onCheckedChange={setIsActive} />
          Active (inactive schedules are ignored when resolving who is on call)
        </label>
      ) : null}

      <div className="flex justify-end border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {editing ? "Save changes" : "Create schedule"}
        </Button>
      </div>
    </form>
  );
}
