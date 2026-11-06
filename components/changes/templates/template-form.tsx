"use client";

import { useActionState, useEffect, useState } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { useFormSubmit } from "@/hooks/use-form-submit";
import {
  createChangeTemplate,
  updateChangeTemplate,
  type TemplateActionState,
} from "@/lib/actions/change-templates";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/link-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/combo-field";
import { Combobox, type ComboOption } from "@/components/combobox";
import { isPreAuthorized } from "@/lib/change-template-rules";
import {
  CHANGE_TEMPLATE_TYPES, RISKS, PRIORITIES, IMPACT_URGENCY,
  CHANGE_TYPE_META, RISK_META, PRIORITY_META, LEVEL_META,
} from "@/lib/constants";
import type { FormOptions } from "@/lib/data/options";

export type EditableTemplate = {
  id: string;
  name: string;
  summary: string | null;
  isActive: boolean;
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
  serviceId: string | null;
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

const option = (value: string, meta: { label: string; tone: ComboOption["tone"]; icon?: ComboOption["icon"] }): ComboOption => ({
  value, label: meta.label, tone: meta.tone, icon: meta.icon,
});

/** Creates a change template, or edits `template` when given. */
export function TemplateForm({ options, template }: { options: FormOptions; template?: EditableTemplate }) {
  const [state, action, pending] = useActionState<TemplateActionState, FormData>(
    template ? updateChangeTemplate : createChangeTemplate,
    undefined,
  );
  const submit = useFormSubmit(action);
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const [type, setType] = useState(template?.type ?? "STANDARD");
  const fe = state?.fieldErrors ?? {};

  useEffect(() => {
    if (state?.saved) toast.success("Template saved");
  }, [state]);

  const typeOpts = CHANGE_TEMPLATE_TYPES.map((t) => option(t, CHANGE_TYPE_META[t]));
  const riskOpts = RISKS.map((r) => option(r, RISK_META[r]));
  const prioOpts = PRIORITIES.map((p) => option(p, PRIORITY_META[p]));
  const impactOpts = IMPACT_URGENCY.map((l) => option(l, LEVEL_META[l]));
  const groupOpts: ComboOption[] = options.groups.map((g) => ({ value: g.id, label: g.name }));
  const catOpts: ComboOption[] = options.categories.map((c) => ({ value: c.id, label: c.name }));
  const serviceOpts: ComboOption[] = options.services.map((s) => ({ value: s.id, label: s.name }));

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      {template ? <input type="hidden" name="id" value={template.id} /> : null}
      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Template name" error={fe.name} hint="Shown in the template picker.">
          <Input name="name" defaultValue={template?.name} placeholder="e.g. Rotate TLS certificate" required />
        </Field>
        <Field label="Type" hint={isPreAuthorized(type) ? "Standard: changes created from this template are pre-approved, no CAB review." : "Normal: changes go through CAB review."}>
          <Combobox name="type" options={typeOpts} value={type} onChange={setType} />
        </Field>
      </div>

      <Field label="When to use it" error={fe.summary}>
        <Input name="summary" defaultValue={template?.summary ?? ""} placeholder="Short guidance for the person picking the template" />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(!!v)} />
        Available in the picker
        <input type="hidden" name="isActive" value={isActive ? "on" : ""} />
      </label>

      <div className="grid gap-5 border-t pt-5">
        <Field label="Change title" error={fe.title}>
          <Input name="title" defaultValue={template?.title} placeholder="Prefilled title of the change" required />
        </Field>
        <Field label="Description" error={fe.description}>
          <Textarea name="description" defaultValue={template?.description} className="min-h-24" />
        </Field>
        <Field label="Reason for change">
          <Textarea name="reason" defaultValue={template?.reason ?? ""} className="min-h-20" />
        </Field>
        <Field label="Implementation plan" error={fe.implementationPlan}>
          <Textarea name="implementationPlan" defaultValue={template?.implementationPlan ?? ""} className="min-h-24" />
        </Field>
        <Field label="Rollback plan" error={fe.rollbackPlan}>
          <Textarea name="rollbackPlan" defaultValue={template?.rollbackPlan ?? ""} className="min-h-24" />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Risk"><ComboField name="risk" defaultValue={template?.risk ?? "LOW"} options={riskOpts} /></Field>
        <Field label="Priority"><ComboField name="priority" defaultValue={template?.priority ?? "MEDIUM"} options={prioOpts} /></Field>
        <Field label="Impact"><ComboField name="impact" defaultValue={template?.impact ?? "MEDIUM"} options={impactOpts} /></Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Category">
          <ComboField name="categoryId" defaultValue={template?.categoryId ?? "none"} options={catOpts} includeNone noneLabel="No category" />
        </Field>
        <Field label="Service" hint="Groups the template with that service in the picker.">
          <ComboField name="serviceId" defaultValue={template?.serviceId ?? "none"} options={serviceOpts} includeNone noneLabel="No service" />
        </Field>
        <Field label="Group">
          <ComboField name="groupId" defaultValue={template?.groupId ?? "none"} options={groupOpts} includeNone noneLabel="No group" />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <LinkButton href="/changes/templates" variant="ghost">Cancel</LinkButton>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : template ? <Save className="size-4" /> : <Plus className="size-4" />}
          {template ? "Save template" : "Create template"}
        </Button>
      </div>
    </form>
  );
}
