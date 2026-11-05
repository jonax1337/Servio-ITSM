"use client";

import { useActionState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Loader2, Plus } from "lucide-react";
import { createChange, type ActionState } from "@/lib/actions/changes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/combo-field";
import { FormCustomFields } from "@/components/custom-fields/form-custom-fields";
import type { CustomFieldDef } from "@/lib/custom-fields";
import type { ComboOption } from "@/components/combobox";
import {
  CHANGE_TYPES, RISKS, PRIORITIES, IMPACT_URGENCY,
  CHANGE_TYPE_META, RISK_META, PRIORITY_META, LEVEL_META,
} from "@/lib/constants";
import type { FormOptions } from "@/lib/data/options";

function Field({
  label, error, children, hint,
}: { label: string; error?: string[]; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{error[0]}</p> : null}
    </div>
  );
}

const initials = (s: string) => s.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export function ChangeForm({
  options, currentUserId, customFieldDefs = [],
}: {
  options: FormOptions;
  currentUserId: string;
  customFieldDefs?: CustomFieldDef[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createChange, undefined);
  const submit = useFormSubmit(action);
  const fe = state?.fieldErrors ?? {};

  const typeOpts: ComboOption[] = CHANGE_TYPES.map((t) => ({ value: t, label: CHANGE_TYPE_META[t].label, tone: CHANGE_TYPE_META[t].tone, icon: CHANGE_TYPE_META[t].icon }));
  const riskOpts: ComboOption[] = RISKS.map((r) => ({ value: r, label: RISK_META[r].label, tone: RISK_META[r].tone, icon: RISK_META[r].icon }));
  const prioOpts: ComboOption[] = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label, tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon }));
  const impactOpts: ComboOption[] = IMPACT_URGENCY.map((l) => ({ value: l, label: LEVEL_META[l].label, tone: LEVEL_META[l].tone, icon: LEVEL_META[l].icon }));
  const agentOpts: ComboOption[] = options.agents.map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email }));
  const groupOpts: ComboOption[] = options.groups.map((g) => ({ value: g.id, label: g.name }));
  const catOpts: ComboOption[] = options.categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <form onSubmit={submit} className="grid gap-5">
      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Field label="Title" error={fe.title}>
        <Input name="title" placeholder="Short summary of the change" required />
      </Field>

      <Field label="Description" error={fe.description}>
        <Textarea name="description" placeholder="What is being changed and why…" className="min-h-32" />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Type"><ComboField name="type" defaultValue="NORMAL" options={typeOpts} /></Field>
        <Field label="Risk"><ComboField name="risk" defaultValue="MEDIUM" options={riskOpts} /></Field>
        <Field label="Priority"><ComboField name="priority" defaultValue="MEDIUM" options={prioOpts} /></Field>
        <Field label="Impact"><ComboField name="impact" defaultValue="MEDIUM" options={impactOpts} /></Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Assignee">
          <ComboField name="assigneeId" defaultValue={currentUserId} options={agentOpts} includeNone noneLabel="Unassigned" />
        </Field>
        <Field label="Group">
          <ComboField name="groupId" options={groupOpts} includeNone noneLabel="No group" />
        </Field>
        <Field label="Category">
          <ComboField name="categoryId" options={catOpts} includeNone noneLabel="No category" />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Planned start" hint="Optional maintenance window start.">
          <Input type="datetime-local" name="plannedStart" />
        </Field>
        <Field label="Planned end" hint="Optional maintenance window end." error={fe.plannedEnd}>
          <Input type="datetime-local" name="plannedEnd" />
        </Field>
      </div>

      <Field label="Reason for change">
        <Textarea name="reason" placeholder="Business justification…" className="min-h-20" />
      </Field>

      <Field label="Implementation plan">
        <Textarea name="implementationPlan" placeholder="Steps to implement the change…" className="min-h-20" />
      </Field>

      <Field label="Rollback plan">
        <Textarea name="rollbackPlan" placeholder="How to revert if something goes wrong…" className="min-h-20" />
      </Field>

      {customFieldDefs.length > 0 ? (
        <div className="grid gap-3">
          <p className="text-sm font-medium">Custom fields</p>
          <FormCustomFields defs={customFieldDefs} disabled={pending} />
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Create change
        </Button>
      </div>
    </form>
  );
}
