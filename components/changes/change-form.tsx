"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Loader2, Lock, Plus } from "lucide-react";
import { createChange } from "@/lib/actions/changes";
import { createChangeFromTemplateAction, type TemplateActionState } from "@/lib/actions/change-templates";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/link-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/combo-field";
import { StatusBadge } from "@/components/status-badge";
import { FormCustomFields } from "@/components/custom-fields/form-custom-fields";
import type { CustomFieldDef } from "@/lib/custom-fields";
import type { ComboOption } from "@/components/combobox";
import {
  RISKS, PRIORITIES, IMPACT_URGENCY,
  CHANGE_TYPE_META, RISK_META, PRIORITY_META, LEVEL_META, changeRef,
} from "@/lib/constants";
import type { FormOptions } from "@/lib/data/options";
import { isPreAuthorized } from "@/lib/change-template-rules";
import { MANUAL_CHANGE_TYPES } from "@/lib/change-rules";

/** The template a change is being created from; its values prefill the form. */
export type ChangeFormTemplate = {
  id: string;
  type: string;
  title: string;
  description: string;
  reason: string | null;
  implementationPlan: string | null;
  rollbackPlan: string | null;
  risk: string;
  priority: string;
  impact: string;
  categoryId: string | null;
  groupId: string | null;
};

function Field({
  label, error, children, hint,
}: { label: string; error?: string[]; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{error[0]}</p> : null}
    </div>
  );
}

const initials = (s: string) => s.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

function LockedPlan({ label, text }: { label: string; text: string | null }) {
  return (
    <div className="grid gap-1.5">
      <span className="flex items-center gap-1.5 text-sm font-medium leading-none">
        {label}
        <Lock className="size-3 text-muted-foreground" aria-hidden />
      </span>
      <p className="whitespace-pre-wrap rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{text ?? "—"}</p>
      <p className="text-xs text-muted-foreground">Fixed by the template: standard changes follow the approved procedure.</p>
    </div>
  );
}

export function ChangeForm({
  options, currentUserId, customFieldDefs = [], template,
}: {
  options: FormOptions;
  currentUserId: string;
  customFieldDefs?: CustomFieldDef[];
  template?: ChangeFormTemplate;
}) {
  const [state, action, pending] = useActionState<TemplateActionState, FormData>(
    template ? createChangeFromTemplateAction : createChange,
    undefined,
  );
  // A pre-authorized template fixes the procedure; the server ignores edits to these fields.
  const procedureFixed = !!template && isPreAuthorized(template.type);
  const submit = useFormSubmit(action);
  const fe = state?.fieldErrors ?? {};

  const typeOpts: ComboOption[] = MANUAL_CHANGE_TYPES.map((t) => ({ value: t, label: CHANGE_TYPE_META[t].label, tone: CHANGE_TYPE_META[t].tone, icon: CHANGE_TYPE_META[t].icon }));
  const riskOpts: ComboOption[] = RISKS.map((r) => ({ value: r, label: RISK_META[r].label, tone: RISK_META[r].tone, icon: RISK_META[r].icon }));
  const prioOpts: ComboOption[] = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label, tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon }));
  const impactOpts: ComboOption[] = IMPACT_URGENCY.map((l) => ({ value: l, label: LEVEL_META[l].label, tone: LEVEL_META[l].tone, icon: LEVEL_META[l].icon }));
  const agentOpts: ComboOption[] = options.agents.map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email }));
  const groupOpts: ComboOption[] = options.groups.map((g) => ({ value: g.id, label: g.name }));
  const catOpts: ComboOption[] = options.categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      {state?.draftChangeId ? (
        <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {changeRef(state.draftChangeId)} was created as a draft but could not be pre-approved: {state.error}{" "}
          <Link href={`/changes/${state.draftChangeId}`} className="font-medium underline underline-offset-2">
            Open the change
          </Link>{" "}
          to adjust it and submit it again.
        </p>
      ) : state?.error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {template ? <input type="hidden" name="templateId" value={template.id} /> : null}

      <Field label="Title" error={fe.title}>
        <Input name="title" defaultValue={template?.title} placeholder="Short summary of the change" required />
      </Field>

      <Field label="Description" error={fe.description}>
        <Textarea name="description" defaultValue={template?.description} placeholder="What is being changed and why…" className="min-h-32" />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Type">
          {template ? <StatusBadge map={CHANGE_TYPE_META} value={template.type} dot className="w-fit" /> : <ComboField name="type" defaultValue="NORMAL" options={typeOpts} />}
        </Field>
        <Field label="Risk">
          {procedureFixed ? <StatusBadge map={RISK_META} value={template.risk} dot className="w-fit" /> : <ComboField name="risk" defaultValue={template?.risk ?? "MEDIUM"} options={riskOpts} />}
        </Field>
        <Field label="Priority"><ComboField name="priority" defaultValue={template?.priority ?? "MEDIUM"} options={prioOpts} /></Field>
        <Field label="Impact">
          {procedureFixed ? <StatusBadge map={LEVEL_META} value={template.impact} dot className="w-fit" /> : <ComboField name="impact" defaultValue={template?.impact ?? "MEDIUM"} options={impactOpts} />}
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Assignee">
          <ComboField name="assigneeId" defaultValue={currentUserId} options={agentOpts} includeNone noneLabel="Unassigned" />
        </Field>
        <Field label="Group">
          <ComboField name="groupId" defaultValue={template?.groupId ?? undefined} options={groupOpts} includeNone noneLabel="No group" />
        </Field>
        <Field label="Category">
          <ComboField name="categoryId" defaultValue={template?.categoryId ?? undefined} options={catOpts} includeNone noneLabel="No category" />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Planned start">
          <Input type="datetime-local" name="plannedStart" />
        </Field>
        <Field label="Planned end" error={fe.plannedEnd}>
          <Input type="datetime-local" name="plannedEnd" />
        </Field>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Optional maintenance window. A change planned inside a freeze cannot be submitted; check the{" "}
          <Link href="/changes/calendar" className="underline underline-offset-2 hover:text-foreground">
            change calendar
          </Link>{" "}
          for freezes and overlapping changes.
        </p>
      </div>

      <Field label="Reason for change">
        <Textarea name="reason" defaultValue={template?.reason ?? ""} placeholder="Business justification…" className="min-h-20" />
      </Field>

      {procedureFixed ? (
        <>
          <LockedPlan label="Implementation plan" text={template.implementationPlan} />
          <LockedPlan label="Rollback plan" text={template.rollbackPlan} />
        </>
      ) : (
        <>
          <Field label="Implementation plan">
            <Textarea name="implementationPlan" defaultValue={template?.implementationPlan ?? ""} placeholder="Steps to implement the change…" className="min-h-20" />
          </Field>

          <Field label="Rollback plan">
            <Textarea name="rollbackPlan" defaultValue={template?.rollbackPlan ?? ""} placeholder="How to revert if something goes wrong…" className="min-h-20" />
          </Field>
        </>
      )}

      {customFieldDefs.length > 0 ? (
        <div className="grid gap-3">
          <p className="text-sm font-medium">Custom fields</p>
          <FormCustomFields defs={customFieldDefs} disabled={pending} />
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <LinkButton href="/changes" variant="ghost">Cancel</LinkButton>
        <Button type="submit" disabled={pending || !!state?.draftChangeId}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Create change
        </Button>
      </div>
    </form>
  );
}
