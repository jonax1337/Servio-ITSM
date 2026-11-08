"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2, Loader2, Save, Timer, Power } from "lucide-react";
import { createSla, updateSla, toggleSla, deleteSla, type SlaState } from "@/lib/actions/sla-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmButton } from "@/components/confirm-dialog";
import { PRIORITIES, PRIORITY_META } from "@/lib/constants";
import { formatMinutes } from "@/lib/utils";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

export type SlaRow = {
  id: string;
  name: string;
  description: string | null;
  priority: string | null;
  responseMins: number;
  resolveMins: number;
  isActive: boolean;
  businessCalendarId: string | null;
  escalationPolicyId: string | null;
};

export type NamedRef = { id: string; name: string };

function Field({ label, error, children, hint }: { label: string; error?: string[]; children: React.ReactNode; hint?: string }) {
  const tm = useServerMessage();
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{tm(error[0])}</p> : null}
    </div>
  );
}

function SlaDialog({ sla, calendars, policies }: { sla?: SlaRow; calendars: NamedRef[]; policies: NamedRef[] }) {
  const editing = !!sla;
  const t = useT("settings");
  const te = useEnumT();
  const tm = useServerMessage();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SlaState>(undefined);
  const [pending, startTransition] = useTransition();
  const [priority, setPriority] = useState(sla?.priority ?? "none");
  const [calendarId, setCalendarId] = useState(sla?.businessCalendarId ?? "none");
  const [policyId, setPolicyId] = useState(sla?.escalationPolicyId ?? "none");
  const [isActive, setIsActive] = useState(sla?.isActive ?? true);
  const fe = state?.fieldErrors ?? {};

  // Call the action directly so we can read its result and close ONLY on success,
  // keeping validation errors visible in the still-open dialog.
  const submit = (formData: FormData) => {
    startTransition(async () => {
      const res = await (editing ? updateSla : createSla)(undefined, formData);
      setState(res);
      if (!res || res.ok) setOpen(false);
    });
  };

  const prioOpts: ComboOption[] = [
    { value: "none", label: t("slaMgr.anyPriority") },
    ...PRIORITIES.map((p) => ({ value: p, label: te(PRIORITY_META[p]), tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon })),
  ];
  const calOpts: ComboOption[] = [
    { value: "none", label: t("slaMgr.wallClock") },
    ...calendars.map((c) => ({ value: c.id, label: c.name })),
  ];
  const policyOpts: ComboOption[] = [
    { value: "none", label: t("slaMgr.noEscalation") },
    ...policies.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={editing ? "outline" : "default"} size={editing ? "icon-sm" : "default"} aria-label={editing ? t("slaMgr.editSla") : undefined} />}>
        {editing ? <Pencil className="size-4" /> : <><Plus className="size-4" /> {t("slaMgr.newSla")}</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Timer className="size-4 text-primary" /> {editing ? t("slaMgr.editSla") : t("slaMgr.newSla")}</DialogTitle>
          <DialogDescription>{t("slaMgr.dialogDescription")}</DialogDescription>
        </DialogHeader>

        <form action={submit} className="grid gap-4">
          {editing ? <input type="hidden" name="id" value={sla.id} /> : null}
          <input type="hidden" name="priority" value={priority} />
          <input type="hidden" name="businessCalendarId" value={calendarId} />
          <input type="hidden" name="escalationPolicyId" value={policyId} />
          <input type="hidden" name="isActive" value={String(isActive)} />

          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{tm(state.error)}</p>
          ) : null}

          <Field label={t("slaMgr.name")} error={fe.name}>
            <Input name="name" defaultValue={sla?.name} placeholder={t("slaMgr.namePlaceholder")} required />
          </Field>

          <Field label={t("slaMgr.description")} error={fe.description}>
            <Textarea name="description" defaultValue={sla?.description ?? ""} placeholder={t("slaMgr.descriptionPlaceholder")} className="min-h-16" />
          </Field>

          <Field label={t("slaMgr.appliesTo")} error={fe.priority} hint={t("slaMgr.appliesToHint")}>
            <Combobox options={prioOpts} value={priority} onChange={setPriority} />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label={t("slaMgr.responseTarget")} error={fe.responseMins}>
              <Input name="responseMins" type="number" min={1} defaultValue={sla?.responseMins ?? 60} required />
            </Field>
            <Field label={t("slaMgr.resolveTarget")} error={fe.resolveMins}>
              <Input name="resolveMins" type="number" min={1} defaultValue={sla?.resolveMins ?? 480} required />
            </Field>
          </div>

          <Field label={t("slaMgr.calendar")} hint={t("slaMgr.calendarHint")}>
            <Combobox options={calOpts} value={calendarId} onChange={setCalendarId} />
          </Field>

          <Field label={t("slaMgr.policy")} hint={t("slaMgr.policyHint")}>
            <Combobox options={policyOpts} value={policyId} onChange={setPolicyId} />
          </Field>

          <label className="flex items-center justify-between rounded-lg border p-3 text-sm">
            <span>{t("slaMgr.active")}</span>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </label>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editing ? t("slaMgr.saveSla") : t("slaMgr.createSla")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SlaManager({
  slas,
  calendars,
  policies,
}: {
  slas: SlaRow[];
  calendars: NamedRef[];
  policies: NamedRef[];
}) {
  const t = useT("settings");
  const calName = (id: string | null) => calendars.find((c) => c.id === id)?.name;
  const policyName = (id: string | null) => policies.find((p) => p.id === id)?.name;
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("slaMgr.summary", { count: slas.length })}
        </p>
        <SlaDialog calendars={calendars} policies={policies} />
      </div>

      {slas.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {t("slaMgr.empty")}
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border">
          {slas.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className={`grid size-9 place-items-center rounded-lg border ${s.isActive ? "text-primary" : "text-muted-foreground opacity-60"}`}>
                <Timer className="size-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{s.name}</span>
                  {!s.isActive ? <span className="rounded-full border px-1.5 text-[10px] font-medium text-muted-foreground">{t("slaMgr.inactive")}</span> : null}
                </div>
                <div className="truncate text-xs text-muted-foreground">{s.description || t("slaMgr.noDescription")}</div>
              </div>

              {s.priority ? (
                <StatusBadge map={PRIORITY_META} value={s.priority} />
              ) : (
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{t("slaMgr.anyPriority")}</span>
              )}

              <div className="text-xs text-muted-foreground">
                {t("slaMgr.respond")} <span className="font-medium text-foreground">{formatMinutes(s.responseMins)}</span> · {t("slaMgr.resolve")} <span className="font-medium text-foreground">{formatMinutes(s.resolveMins)}</span>
                {calName(s.businessCalendarId) ? (
                  <span className="ml-2 rounded-full border px-2 py-0.5">{calName(s.businessCalendarId)}</span>
                ) : null}
                {policyName(s.escalationPolicyId) ? (
                  <span className="ml-1 rounded-full border px-2 py-0.5">↑ {policyName(s.escalationPolicyId)}</span>
                ) : null}
              </div>

              <div className="flex items-center gap-1">
                <form action={toggleSla}>
                  <input type="hidden" name="id" value={s.id} />
                  <Button type="submit" variant="ghost" size="icon-sm" title={s.isActive ? t("slaMgr.deactivate") : t("slaMgr.activate")}>
                    <Power className="size-4" />
                  </Button>
                </form>
                <SlaDialog sla={s} calendars={calendars} policies={policies} />
                <ConfirmButton
                  action={deleteSla}
                  fields={{ id: s.id }}
                  title={t("slaMgr.deleteTitle")}
                  description={t("slaMgr.deleteDescription", { name: s.name })}
                  triggerLabel={t("slaMgr.deleteSla")}
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
