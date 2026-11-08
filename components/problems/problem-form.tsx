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
import { statusRequirementError } from "@/lib/problem-rules";
import type { CustomFieldDef } from "@/lib/custom-fields";
import type { ComboOption } from "@/components/combobox";
import {
  PROBLEM_STATUSES, PRIORITIES, IMPACT_URGENCY,
  PROBLEM_STATUS_META, PRIORITY_META, LEVEL_META,
} from "@/lib/constants";
import type { FormOptions } from "@/lib/data/options";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

function Field({
  label, error, children, hint,
}: { label: string; error?: string[]; children: React.ReactNode; hint?: string }) {
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
  const t = useT("problems");
  const tc = useT("common");
  const te = useEnumT();
  const tm = useServerMessage();

  // A new problem has no root cause or workaround yet, so only statuses without that requirement apply.
  const statusOpts: ComboOption[] = PROBLEM_STATUSES.filter((s) => !statusRequirementError(s, { rootCause: null, workaround: null })).map((s) => ({ value: s, label: te(PROBLEM_STATUS_META[s]), tone: PROBLEM_STATUS_META[s].tone, icon: PROBLEM_STATUS_META[s].icon }));
  const prioOpts: ComboOption[] = PRIORITIES.map((p) => ({ value: p, label: te(PRIORITY_META[p]), tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon }));
  const levelOpts: ComboOption[] = IMPACT_URGENCY.map((l) => ({ value: l, label: te(LEVEL_META[l]), tone: LEVEL_META[l].tone }));
  const agentOpts: ComboOption[] = options.agents.map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email }));
  const groupOpts: ComboOption[] = options.groups.map((g) => ({ value: g.id, label: g.name }));
  const catOpts: ComboOption[] = options.categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tm(state.error)}
        </p>
      ) : null}

      <Field label={tc("title")} error={fe.title}>
        <Input name="title" placeholder={t("form.titlePlaceholder")} required />
      </Field>

      <Field label={tc("description")} error={fe.description}>
        <Textarea name="description" placeholder={t("form.descriptionPlaceholder")} className="min-h-32" />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tc("status")}><ComboField name="status" defaultValue="NEW" options={statusOpts} /></Field>
        <Field label={tc("priority")}><ComboField name="priority" defaultValue="MEDIUM" options={prioOpts} /></Field>
        <Field label={tc("impact")}><ComboField name="impact" defaultValue="MEDIUM" options={levelOpts} /></Field>
        <Field label={tc("assignee")}>
          <ComboField name="assigneeId" defaultValue={currentUserId} options={agentOpts} includeNone noneLabel={tc("unassigned")} />
        </Field>
        <Field label={tc("group")}>
          <ComboField name="groupId" options={groupOpts} includeNone noneLabel={t("noGroup")} />
        </Field>
        <Field label={tc("category")}>
          <ComboField name="categoryId" options={catOpts} includeNone noneLabel={t("noCategory")} />
        </Field>
      </div>

      {customFieldDefs.length > 0 ? (
        <div className="grid gap-3">
          <p className="text-sm font-medium">{t("customFields")}</p>
          <FormCustomFields defs={customFieldDefs} disabled={pending} />
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {t("form.create")}
        </Button>
      </div>
    </form>
  );
}
