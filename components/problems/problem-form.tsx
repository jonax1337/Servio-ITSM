"use client";

import { useActionState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Loader2, Plus } from "lucide-react";
import { createProblem, type ActionState } from "@/lib/actions/problems";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/combo-field";
import { FormCustomFields } from "@/components/custom-fields/form-custom-fields";
import type { CustomFieldDef } from "@/lib/custom-fields";
import type { ComboOption } from "@/components/combobox";
import {
  PROBLEM_STATUSES, PRIORITIES, IMPACT_URGENCY,
  PROBLEM_STATUS_META, PRIORITY_META, LEVEL_META,
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

export function ProblemForm({
  options, currentUserId, customFieldDefs = [],
}: {
  options: FormOptions;
  currentUserId: string;
  customFieldDefs?: CustomFieldDef[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createProblem, undefined);
  const submit = useFormSubmit(action);
  const fe = state?.fieldErrors ?? {};

  const statusOpts: ComboOption[] = PROBLEM_STATUSES.map((s) => ({ value: s, label: PROBLEM_STATUS_META[s].label, tone: PROBLEM_STATUS_META[s].tone, icon: PROBLEM_STATUS_META[s].icon }));
  const prioOpts: ComboOption[] = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label, tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon }));
  const levelOpts: ComboOption[] = IMPACT_URGENCY.map((l) => ({ value: l, label: LEVEL_META[l].label, tone: LEVEL_META[l].tone }));
  const agentOpts: ComboOption[] = options.agents.map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email }));
  const groupOpts: ComboOption[] = options.groups.map((g) => ({ value: g.id, label: g.name }));
  const catOpts: ComboOption[] = options.categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Field label="Title" error={fe.title}>
        <Input name="title" placeholder="Short summary of the underlying problem" required />
      </Field>

      <Field label="Description" error={fe.description}>
        <Textarea name="description" placeholder="Describe the recurring issue, affected services, symptoms…" className="min-h-32" />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Status"><ComboField name="status" defaultValue="NEW" options={statusOpts} /></Field>
        <Field label="Priority"><ComboField name="priority" defaultValue="MEDIUM" options={prioOpts} /></Field>
        <Field label="Impact"><ComboField name="impact" defaultValue="MEDIUM" options={levelOpts} /></Field>
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

      {customFieldDefs.length > 0 ? (
        <div className="grid gap-3">
          <p className="text-sm font-medium">Custom fields</p>
          <FormCustomFields defs={customFieldDefs} disabled={pending} />
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Create problem
        </Button>
      </div>
    </form>
  );
}
