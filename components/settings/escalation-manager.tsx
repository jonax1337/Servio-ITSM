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

const ONCALL_TARGET_LABEL = "On call for the ticket’s group";

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
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{error[0]}</p> : null}
    </div>
  );
}

function PolicyDialog({ policy }: { policy?: PolicyRow }) {
  const editing = !!policy;
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
      <DialogTrigger render={<Button variant={editing ? "outline" : "default"} size={editing ? "icon-sm" : "default"} aria-label={editing ? "Rename policy" : undefined} />}>
        {editing ? <Pencil className="size-4" /> : <><Plus className="size-4" /> New policy</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><TrendingUp className="size-4 text-primary" /> {editing ? "Rename policy" : "New escalation policy"}</DialogTitle>
          <DialogDescription>A named set of steps fired as an SLA’s clock elapses. Add steps after creating it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          {editing ? <input type="hidden" name="id" value={policy.id} /> : null}
          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
          ) : null}
          <Field label="Name" error={state?.fieldErrors?.name}>
            <Input name="name" defaultValue={policy?.name} placeholder="e.g. Tiered escalation" required />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editing ? "Save" : "Create policy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StepDialog({ policyId, groups, users }: { policyId: string; groups: NamedRef[]; users: NamedRef[] }) {
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
    value: a, label: ESCALATION_ACTION_META[a].label, tone: ESCALATION_ACTION_META[a].tone, icon: ESCALATION_ACTION_META[a].icon,
  }));
  const groupOpts: ComboOption[] = [{ value: "none", label: "— None —" }, ...groups.map((g) => ({ value: g.id, label: g.name }))];
  const userOpts: ComboOption[] = [{ value: "none", label: "— None —" }, ...users.map((u) => ({ value: u.id, label: u.name }))];
  const prioOpts: ComboOption[] = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label, tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Plus className="size-4" /> Add step
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add escalation step</DialogTitle>
          <DialogDescription>Runs once when the ticket’s SLA reaches the threshold percentage of elapsed time.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <input type="hidden" name="policyId" value={policyId} />
          <input type="hidden" name="action" value={action} />
          <input type="hidden" name="targetGroupId" value={groupId} />
          <input type="hidden" name="targetUserId" value={userId} />
          <input type="hidden" name="bumpToPriority" value={bumpTo} />

          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Threshold (% elapsed)" error={fe.thresholdPercent} hint="e.g. 50, 75, 100">
              <Input name="thresholdPercent" type="number" min={1} max={1000} defaultValue={75} required />
            </Field>
            <Field label="Action">
              <Combobox options={actionOpts} value={action} onChange={setAction} />
            </Field>
          </div>

          {action === "BUMP_PRIORITY" ? (
            <Field label="Bump to priority" error={fe.bumpToPriority}>
              <Combobox options={prioOpts} value={bumpTo} onChange={setBumpTo} />
            </Field>
          ) : isOnCallEscalationAction(action) ? (
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {action === "NOTIFY_ONCALL"
                ? "Notifies whoever is on call for the ticket’s group. If nobody is, the whole group is notified instead."
                : "Assigns the ticket to whoever is on call for its group. If nobody is, the ticket stays as it is and the group is notified."}{" "}
              Rotations are set up under <Link href="/oncall" className="font-medium text-foreground underline-offset-2 hover:underline">On-call</Link>.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <Field label="Target group" error={fe.targetGroupId}>
                <Combobox options={groupOpts} value={groupId} onChange={setGroupId} />
              </Field>
              <Field label="Target user" error={fe.targetUserId}>
                <Combobox options={userOpts} value={userId} onChange={setUserId} />
              </Field>
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Add step
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function stepTarget(step: StepRow, groups: NamedRef[], users: NamedRef[]): string {
  if (step.action === "BUMP_PRIORITY") return step.bumpToPriority ?? "—";
  if (isOnCallEscalationAction(step.action)) return ONCALL_TARGET_LABEL;
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
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {policies.length} polic{policies.length === 1 ? "y" : "ies"} · steps fire once as the SLA clock crosses each threshold.
        </p>
        <PolicyDialog />
      </div>

      {policies.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="No escalation policies yet"
          description="Create a policy, add threshold steps (notify, reassign, bump priority or reach whoever is on call), then assign it to an SLA."
        />
      ) : (
        <div className="grid gap-3">
          {policies.map((p) => (
            <div key={p.id} className="rounded-xl border">
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="grid size-9 place-items-center rounded-lg border text-primary"><TrendingUp className="size-4.5" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.steps.length} step{p.steps.length === 1 ? "" : "s"}</div>
                </div>
                <PolicyDialog policy={p} />
                <ConfirmButton
                  action={deletePolicy}
                  fields={{ id: p.id }}
                  title="Delete policy?"
                  description={`"${p.name}" and its steps will be removed and unlinked from any SLAs. This can't be undone.`}
                  triggerLabel="Delete policy"
                >
                  <Trash2 className="size-4" />
                </ConfirmButton>
              </div>

              <div className="border-t px-4 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Steps</span>
                  <StepDialog policyId={p.id} groups={groups} users={users} />
                </div>
                {p.steps.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No steps yet.</p>
                ) : (
                  <ul className="divide-y">
                    {p.steps.map((s) => (
                      <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
                        <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{s.thresholdPercent}%</span>
                        <StatusBadge map={ESCALATION_ACTION_META} value={s.action} />
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{stepTarget(s, groups, users)}</span>
                        <ConfirmButton
                          action={deleteStep}
                          fields={{ id: s.id }}
                          title="Delete escalation step?"
                          description={`The ${s.thresholdPercent}% step will be removed from this policy.`}
                          triggerVariant="ghost"
                          triggerLabel="Delete step"
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
