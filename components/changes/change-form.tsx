"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Loader2, Lock, Plus } from "lucide-react";
import { createChange, searchAffectedCis } from "@/lib/actions/changes";
import { createChangeFromTemplateAction, type TemplateActionState } from "@/lib/actions/change-templates";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/link-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/combo-field";
import { MultiCombobox } from "@/components/multi-combobox";
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
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

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

const initials = (s: string) => s.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

function LockedPlan({ label, text }: { label: string; text: string | null }) {
  const t = useT("changes");
  return (
    <div className="grid gap-1.5">
      <span className="flex items-center gap-1.5 text-sm font-medium leading-none">
        {label}
        <Lock className="size-3 text-muted-foreground" aria-hidden />
      </span>
      <p className="whitespace-pre-wrap rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{text ?? "—"}</p>
      <p className="text-xs text-muted-foreground">{t("form.fixedByTemplate")}</p>
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
  const t = useT("changes");
  const tc = useT("common");
  const te = useEnumT();
  const tm = useServerMessage();
  const fe = state?.fieldErrors ?? {};

  const typeOpts: ComboOption[] = MANUAL_CHANGE_TYPES.map((ty) => ({ value: ty, label: te(CHANGE_TYPE_META[ty]), tone: CHANGE_TYPE_META[ty].tone, icon: CHANGE_TYPE_META[ty].icon }));
  const riskOpts: ComboOption[] = RISKS.map((r) => ({ value: r, label: te(RISK_META[r]), tone: RISK_META[r].tone, icon: RISK_META[r].icon }));
  const prioOpts: ComboOption[] = PRIORITIES.map((p) => ({ value: p, label: te(PRIORITY_META[p]), tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon }));
  const impactOpts: ComboOption[] = IMPACT_URGENCY.map((l) => ({ value: l, label: te(LEVEL_META[l]), tone: LEVEL_META[l].tone, icon: LEVEL_META[l].icon }));
  const agentOpts: ComboOption[] = options.agents.map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email }));
  const groupOpts: ComboOption[] = options.groups.map((g) => ({ value: g.id, label: g.name }));
  const catOpts: ComboOption[] = options.categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      {state?.draftChangeId ? (
        <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {t.rich("form.draftNotPreApproved", {
            ref: changeRef(state.draftChangeId),
            error: tm(state.error),
            link: (chunks) => (
              <Link href={`/changes/${state.draftChangeId}`} className="font-medium underline underline-offset-2">
                {chunks}
              </Link>
            ),
          })}
        </p>
      ) : state?.error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tm(state.error)}
        </p>
      ) : null}

      {template ? <input type="hidden" name="templateId" value={template.id} /> : null}

      <Field label={tc("title")} error={fe.title}>
        <Input name="title" defaultValue={template?.title} placeholder={t("form.titlePlaceholder")} required />
      </Field>

      <Field label={tc("description")} error={fe.description}>
        <Textarea name="description" defaultValue={template?.description} placeholder={t("form.descriptionPlaceholder")} className="min-h-32" />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tc("type")}>
          {template ? <StatusBadge map={CHANGE_TYPE_META} value={template.type} dot className="w-fit" /> : <ComboField name="type" defaultValue="NORMAL" options={typeOpts} />}
        </Field>
        <Field label={tc("risk")}>
          {procedureFixed ? <StatusBadge map={RISK_META} value={template.risk} dot className="w-fit" /> : <ComboField name="risk" defaultValue={template?.risk ?? "MEDIUM"} options={riskOpts} />}
        </Field>
        <Field label={tc("priority")}><ComboField name="priority" defaultValue={template?.priority ?? "MEDIUM"} options={prioOpts} /></Field>
        <Field label={tc("impact")}>
          {procedureFixed ? <StatusBadge map={LEVEL_META} value={template.impact} dot className="w-fit" /> : <ComboField name="impact" defaultValue={template?.impact ?? "MEDIUM"} options={impactOpts} />}
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tc("assignee")}>
          <ComboField name="assigneeId" defaultValue={currentUserId} options={agentOpts} includeNone noneLabel={tc("unassigned")} />
        </Field>
        <Field label={tc("group")}>
          <ComboField name="groupId" defaultValue={template?.groupId ?? undefined} options={groupOpts} includeNone noneLabel={t("props.noGroup")} />
        </Field>
        <Field label={tc("category")}>
          <ComboField name="categoryId" defaultValue={template?.categoryId ?? undefined} options={catOpts} includeNone noneLabel={t("props.noCategory")} />
        </Field>
      </div>

      <Field
        label={t("form.affectedCis")}
        error={fe.assetIds}
        hint={t("form.affectedCisHint")}
      >
        <MultiCombobox name="assetIds" search={searchAffectedCis} placeholder={t("form.addAffectedCis")} searchPlaceholder={t("form.searchCis")} emptyText={t("form.noMatchingAssets")} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("window.plannedStart")}>
          <Input type="datetime-local" name="plannedStart" />
        </Field>
        <Field label={t("window.plannedEnd")} error={fe.plannedEnd}>
          <Input type="datetime-local" name="plannedEnd" />
        </Field>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          {t.rich("form.windowHint", {
            link: (chunks) => (
              <Link href="/changes/calendar" className="underline underline-offset-2 hover:text-foreground">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>

      <Field label={t("overview.reason")}>
        <Textarea name="reason" defaultValue={template?.reason ?? ""} placeholder={t("form.reasonPlaceholder")} className="min-h-20" />
      </Field>

      {procedureFixed ? (
        <>
          <LockedPlan label={t("planning.implementationPlan")} text={template.implementationPlan} />
          <LockedPlan label={t("planning.rollbackPlan")} text={template.rollbackPlan} />
        </>
      ) : (
        <>
          <Field label={t("planning.implementationPlan")}>
            <Textarea name="implementationPlan" defaultValue={template?.implementationPlan ?? ""} placeholder={t("form.implementationPlaceholder")} className="min-h-20" />
          </Field>

          <Field label={t("planning.rollbackPlan")}>
            <Textarea name="rollbackPlan" defaultValue={template?.rollbackPlan ?? ""} placeholder={t("form.rollbackPlaceholder")} className="min-h-20" />
          </Field>
        </>
      )}

      {customFieldDefs.length > 0 ? (
        <div className="grid gap-3">
          <p className="text-sm font-medium">{t("form.customFields")}</p>
          <FormCustomFields defs={customFieldDefs} disabled={pending} />
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <LinkButton href="/changes" variant="ghost">{tc("cancel")}</LinkButton>
        <Button type="submit" disabled={pending || !!state?.draftChangeId}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {t("form.create")}
        </Button>
      </div>
    </form>
  );
}
