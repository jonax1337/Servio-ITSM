"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2, Loader2, Save, TrendingUp } from "lucide-react";
import {
  createPolicy, updatePolicy, deletePolicy, addStep, deleteStep,
  type SlaState,
} from "@/lib/actions/sla-admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmButton } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import {
  ESCALATION_ACTIONS, ESCALATION_ACTION_META, PRIORITIES, PRIORITY_META,
} from "@/lib/constants";
import type { NamedRef } from "@/components/settings/sla-manager";
import { isOnCallEscalationAction } from "@/lib/oncall-rules";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";
import type { EnumTranslator } from "@/lib/i18n/enums";
import type { Translator } from "@/lib/i18n/translate";

export type StepRow = {
  id: string;
  order: number;
  thresholdPercent: number;
  action: string;
  targetGroupId: string | null;
  targetUserId: string | null;
  bumpToPriority: string | null;
};

export type PolicyRow = { id: string; name: string; steps: StepRow[] };

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

function PolicyDialog({ policy }: { policy?: PolicyRow }) {
  const editing = !!policy;
  const t = useT("settings");
  const tm = useServerMessage();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SlaState>(undefined);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const res = await (editing ? updatePolicy : createPolicy)(undefined, formData);
      setState(res);
      if (!res || res.ok) setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={editing ? "outline" : "default"} size={editing ? "icon-sm" : "default"} aria-label={editing ? t("esc.renamePolicy") : undefined} />}>
        {editing ? <Pencil className="size-4" /> : <><Plus className="size-4" /> {t("esc.newPolicy")}</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><TrendingUp className="size-4 text-primary" /> {editing ? t("esc.renamePolicy") : t("esc.newPolicyTitle")}</DialogTitle>
          <DialogDescription>{t("esc.policyDescription")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          {editing ? <input type="hidden" name="id" value={policy.id} /> : null}
          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{tm(state.error)}</p>
          ) : null}
          <Field label={t("esc.name")} error={state?.fieldErrors?.name}>
            <Input name="name" defaultValue={policy?.name} placeholder={t("esc.namePlaceholder")} required />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editing ? t("esc.save") : t("esc.createPolicy")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StepDialog({ policyId, groups, users }: { policyId: string; groups: NamedRef[]; users: NamedRef[] }) {
  const t = useT("settings");
  const te = useEnumT();
  const tm = useServerMessage();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SlaState>(undefined);
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<string>("NOTIFY");
  const [groupId, setGroupId] = useState("none");
  const [userId, setUserId] = useState("none");
  const [bumpTo, setBumpTo] = useState("HIGH");
  const fe = state?.fieldErrors ?? {};

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const res = await addStep(undefined, formData);
      setState(res);
      if (!res || res.ok) setOpen(false);
    });
  };

  const actionOpts: ComboOption[] = ESCALATION_ACTIONS.map((a) => ({
    value: a, label: te(ESCALATION_ACTION_META[a]), tone: ESCALATION_ACTION_META[a].tone, icon: ESCALATION_ACTION_META[a].icon,
  }));
  const groupOpts: ComboOption[] = [{ value: "none", label: t("esc.none") }, ...groups.map((g) => ({ value: g.id, label: g.name }))];
  const userOpts: ComboOption[] = [{ value: "none", label: t("esc.none") }, ...users.map((u) => ({ value: u.id, label: u.name }))];
  const prioOpts: ComboOption[] = PRIORITIES.map((p) => ({ value: p, label: te(PRIORITY_META[p]), tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Plus className="size-4" /> {t("esc.addStep")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("esc.addStepTitle")}</DialogTitle>
          <DialogDescription>{t("esc.stepDescription")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <input type="hidden" name="policyId" value={policyId} />
          <input type="hidden" name="action" value={action} />
          <input type="hidden" name="targetGroupId" value={groupId} />
          <input type="hidden" name="targetUserId" value={userId} />
          <input type="hidden" name="bumpToPriority" value={bumpTo} />

          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{tm(state.error)}</p>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <Field label={t("esc.threshold")} error={fe.thresholdPercent} hint={t("esc.thresholdHint")}>
              <Input name="thresholdPercent" type="number" min={1} max={1000} defaultValue={75} required />
            </Field>
            <Field label={t("esc.action")}>
              <Combobox options={actionOpts} value={action} onChange={setAction} />
            </Field>
          </div>

          {action === "BUMP_PRIORITY" ? (
            <Field label={t("esc.bumpTo")} error={fe.bumpToPriority}>
              <Combobox options={prioOpts} value={bumpTo} onChange={setBumpTo} />
            </Field>
          ) : isOnCallEscalationAction(action) ? (
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {action === "NOTIFY_ONCALL"
                ? t("esc.notifyOncallHint")
                : t("esc.reassignOncallHint")}{" "}
              {t.rich("esc.rotationsHint", {
                link: (c) => (
                  <Link href="/oncall" className="font-medium text-foreground underline-offset-2 hover:underline">
                    {c}
                  </Link>
                ),
              })}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("esc.targetGroup")} error={fe.targetGroupId}>
                <Combobox options={groupOpts} value={groupId} onChange={setGroupId} />
              </Field>
              <Field label={t("esc.targetUser")} error={fe.targetUserId}>
                <Combobox options={userOpts} value={userId} onChange={setUserId} />
              </Field>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} {t("esc.addStep")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function stepTarget(step: StepRow, groups: NamedRef[], users: NamedRef[], t: Translator<"settings">, te: EnumTranslator): string {
  if (step.action === "BUMP_PRIORITY") return te(PRIORITY_META, step.bumpToPriority);
  if (isOnCallEscalationAction(step.action)) return t("esc.oncallTarget");
  const parts: string[] = [];
  const g = groups.find((x) => x.id === step.targetGroupId);
  const u = users.find((x) => x.id === step.targetUserId);
  if (g) parts.push(g.name);
  if (u) parts.push(u.name);
  return parts.length ? parts.join(" · ") : "—";
}

export function EscalationManager({
  policies,
  groups,
  users,
}: {
  policies: PolicyRow[];
  groups: NamedRef[];
  users: NamedRef[];
}) {
  const t = useT("settings");
  const te = useEnumT();
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t("esc.summary", { count: policies.length })}
        </p>
        <PolicyDialog />
      </div>

      {policies.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title={t("esc.emptyTitle")}
          description={t("esc.emptyDescription")}
        />
      ) : (
        <div className="grid gap-3">
          {policies.map((p) => (
            <div key={p.id} className="rounded-xl border">
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="grid size-9 place-items-center rounded-lg border text-primary"><TrendingUp className="size-4.5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{t("esc.stepCount", { count: p.steps.length })}</div>
                </div>
                <PolicyDialog policy={p} />
                <ConfirmButton
                  action={deletePolicy}
                  fields={{ id: p.id }}
                  title={t("esc.deletePolicyTitle")}
                  description={t("esc.deletePolicyDescription", { name: p.name })}
                  triggerLabel={t("esc.deletePolicy")}
                >
                  <Trash2 className="size-4" />
                </ConfirmButton>
              </div>

              <div className="border-t px-4 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">{t("esc.steps")}</span>
                  <StepDialog policyId={p.id} groups={groups} users={users} />
                </div>
                {p.steps.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("esc.noSteps")}</p>
                ) : (
                  <ul className="divide-y">
                    {p.steps.map((s) => (
                      <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                        <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{s.thresholdPercent}%</span>
                        <StatusBadge map={ESCALATION_ACTION_META} value={s.action} />
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{stepTarget(s, groups, users, t, te)}</span>
                        <ConfirmButton
                          action={deleteStep}
                          fields={{ id: s.id }}
                          title={t("esc.deleteStepTitle")}
                          description={t("esc.deleteStepDescription", { percent: s.thresholdPercent })}
                          triggerVariant="ghost"
                          triggerLabel={t("esc.deleteStep")}
                        >
                          <Trash2 className="size-4 text-muted-foreground" />
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
