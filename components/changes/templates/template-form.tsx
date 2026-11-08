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
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

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
  const tm = useServerMessage();
  return (
    <div className="grid content-start gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{tm(error[0])}</p> : null}
    </div>
  );
}

const option = (value: string, meta: { label: string; tone: ComboOption["tone"]; icon?: ComboOption["icon"] }, label: string): ComboOption => ({
  value, label, tone: meta.tone, icon: meta.icon,
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
  const t = useT("changes");
  const tc = useT("common");
  const te = useEnumT();
  const tm = useServerMessage();
  const savedMessage = t("templateForm.saved");

  useEffect(() => {
    if (state?.saved) toast.success(savedMessage);
  }, [state, savedMessage]);

  const typeOpts = CHANGE_TEMPLATE_TYPES.map((ty) => option(ty, CHANGE_TYPE_META[ty], te(CHANGE_TYPE_META[ty])));
  const riskOpts = RISKS.map((r) => option(r, RISK_META[r], te(RISK_META[r])));
  const prioOpts = PRIORITIES.map((p) => option(p, PRIORITY_META[p], te(PRIORITY_META[p])));
  const impactOpts = IMPACT_URGENCY.map((l) => option(l, LEVEL_META[l], te(LEVEL_META[l])));
  const groupOpts: ComboOption[] = options.groups.map((g) => ({ value: g.id, label: g.name }));
  const catOpts: ComboOption[] = options.categories.map((c) => ({ value: c.id, label: c.name }));
  const serviceOpts: ComboOption[] = options.services.map((s) => ({ value: s.id, label: s.name }));

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      {template ? <input type="hidden" name="id" value={template.id} /> : null}
      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{tm(state.error)}</p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("templateForm.name")} error={fe.name} hint={t("templateForm.nameHint")}>
          <Input name="name" defaultValue={template?.name} placeholder={t("templateForm.namePlaceholder")} required />
        </Field>
        <Field label={tc("type")} hint={isPreAuthorized(type) ? t("templateForm.standardHint") : t("templateForm.normalHint")}>
          <Combobox name="type" options={typeOpts} value={type} onChange={setType} />
        </Field>
      </div>

      <Field label={t("templateForm.summary")} error={fe.summary}>
        <Input name="summary" defaultValue={template?.summary ?? ""} placeholder={t("templateForm.summaryPlaceholder")} />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={isActive} onCheckedChange={(v) => setIsActive(!!v)} />
        {t("templateForm.available")}
        <input type="hidden" name="isActive" value={isActive ? "on" : ""} />
      </label>

      <div className="grid gap-5 border-t pt-5">
        <Field label={t("templateForm.changeTitle")} error={fe.title}>
          <Input name="title" defaultValue={template?.title} placeholder={t("templateForm.changeTitlePlaceholder")} required />
        </Field>
        <Field label={tc("description")} error={fe.description}>
          <Textarea name="description" defaultValue={template?.description} className="min-h-24" />
        </Field>
        <Field label={t("overview.reason")}>
          <Textarea name="reason" defaultValue={template?.reason ?? ""} className="min-h-20" />
        </Field>
        <Field label={t("planning.implementationPlan")} error={fe.implementationPlan}>
          <Textarea name="implementationPlan" defaultValue={template?.implementationPlan ?? ""} className="min-h-24" />
        </Field>
        <Field label={t("planning.rollbackPlan")} error={fe.rollbackPlan}>
          <Textarea name="rollbackPlan" defaultValue={template?.rollbackPlan ?? ""} className="min-h-24" />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label={tc("risk")}><ComboField name="risk" defaultValue={template?.risk ?? "LOW"} options={riskOpts} /></Field>
        <Field label={tc("priority")}><ComboField name="priority" defaultValue={template?.priority ?? "MEDIUM"} options={prioOpts} /></Field>
        <Field label={tc("impact")}><ComboField name="impact" defaultValue={template?.impact ?? "MEDIUM"} options={impactOpts} /></Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label={tc("category")}>
          <ComboField name="categoryId" defaultValue={template?.categoryId ?? "none"} options={catOpts} includeNone noneLabel={t("props.noCategory")} />
        </Field>
        <Field label={tc("service")} hint={t("templateForm.serviceHint")}>
          <ComboField name="serviceId" defaultValue={template?.serviceId ?? "none"} options={serviceOpts} includeNone noneLabel={t("templateForm.noService")} />
        </Field>
        <Field label={tc("group")}>
          <ComboField name="groupId" defaultValue={template?.groupId ?? "none"} options={groupOpts} includeNone noneLabel={t("props.noGroup")} />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <LinkButton href="/changes/templates" variant="ghost">{tc("cancel")}</LinkButton>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : template ? <Save className="size-4" /> : <Plus className="size-4" />}
          {template ? t("templateForm.save") : t("templateForm.create")}
        </Button>
      </div>
    </form>
  );
}
