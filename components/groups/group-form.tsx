"use client";

import { useActionState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Loader2, Plus } from "lucide-react";
import { createGroup, type ActionState } from "@/lib/actions/groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/combo-field";
import type { ComboOption } from "@/components/combobox";
import { GROUP_TYPES, GROUP_TYPE_META, AUTO_ASSIGN_STRATEGIES, AUTO_ASSIGN_META } from "@/lib/constants";
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

export function GroupForm({ options }: { options: FormOptions }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createGroup, undefined);
  const submit = useFormSubmit(action);
  const t = useT("groups");
  const te = useEnumT();
  const tm = useServerMessage();
  const fe = state?.fieldErrors ?? {};

  const typeOpts: ComboOption[] = GROUP_TYPES.map((v) => ({ value: v, label: te(GROUP_TYPE_META[v]), tone: GROUP_TYPE_META[v].tone, icon: GROUP_TYPE_META[v].icon }));
  const managerOpts: ComboOption[] = options.agents.map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email }));
  const autoAssignOpts: ComboOption[] = AUTO_ASSIGN_STRATEGIES.map((s) => ({ value: s, label: te(AUTO_ASSIGN_META[s]), tone: AUTO_ASSIGN_META[s].tone }));

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tm(state.error)}
        </p>
      ) : null}

      <Field label={t("name")} error={fe.name}>
        <Input name="name" placeholder={t("namePlaceholder")} required />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("type")} error={fe.type}>
          <ComboField name="type" defaultValue="TEAM" options={typeOpts} />
        </Field>
        <Field label={t("manager")}>
          <ComboField name="managerId" options={managerOpts} includeNone noneLabel={t("noManager")} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t("email")} error={fe.email} hint={t("emailHint")}>
          <Input name="email" type="email" placeholder={t("emailPlaceholder")} />
        </Field>
        <Field label={t("autoAssignment")} hint={t("autoAssignHint")}>
          <ComboField name="autoAssign" defaultValue="OFF" options={autoAssignOpts} />
        </Field>
      </div>

      <Field label={t("descriptionLabel")} error={fe.description}>
        <Textarea name="description" placeholder={t("descriptionPlaceholder")} className="min-h-28" />
      </Field>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {t("createGroup")}
        </Button>
      </div>
    </form>
  );
}
