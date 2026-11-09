"use client";

import { useActionState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Loader2, Plus } from "lucide-react";
import { createService, type ActionState } from "@/lib/actions/services";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/combo-field";
import { IconPicker } from "@/components/icon-picker";
import type { ComboOption } from "@/components/combobox";
import {
  SERVICE_STATUSES,
  CRITICALITIES,
  SERVICE_STATUS_META,
  CRITICALITY_META,
} from "@/lib/constants";
import type { FormOptions } from "@/lib/data/options";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error?: string[];
  children: React.ReactNode;
  hint?: string;
}) {
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

const initials = (s: string) =>
  s.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export function ServiceForm({ options }: { options: FormOptions }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createService,
    undefined,
  );
  const submit = useFormSubmit(action);
  const t = useT("services");
  const tc = useT("common");
  const te = useEnumT();
  const tm = useServerMessage();
  const fe = state?.fieldErrors ?? {};

  const statusOpts: ComboOption[] = SERVICE_STATUSES.map((s) => ({
    value: s,
    label: te(SERVICE_STATUS_META[s]),
    tone: SERVICE_STATUS_META[s].tone,
    icon: SERVICE_STATUS_META[s].icon,
  }));
  const critOpts: ComboOption[] = CRITICALITIES.map((c) => ({
    value: c,
    label: te(CRITICALITY_META[c]),
    tone: CRITICALITY_META[c].tone,
    icon: CRITICALITY_META[c].icon,
  }));
  const ownerOpts: ComboOption[] = options.agents.map((a) => ({
    value: a.id,
    label: a.name ?? a.email,
    avatar: initials(a.name ?? a.email),
    hint: a.email,
  }));
  const catOpts: ComboOption[] = options.categories.map((c) => ({
    value: c.id,
    label: c.name,
  }));
  const teamOpts: ComboOption[] = options.groups.map((g) => ({
    value: g.id,
    label: g.name,
  }));
  const slaOpts: ComboOption[] = options.slas.map((s) => ({
    value: s.id,
    label: s.name,
  }));

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tm(state.error)}
        </p>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
        <Field label={tc("name")} error={fe.name}>
          <Input name="name" placeholder={t("namePlaceholder")} required />
        </Field>
        <Field label={t("code")} error={fe.code}>
          <Input name="code" placeholder={t("codePlaceholder")} maxLength={32} />
        </Field>
      </div>

      <Field label={t("icon")}>
        <IconPicker name="icon" defaultValue="LifeBuoy" />
      </Field>

      <Field label={tc("description")} error={fe.description}>
        <Textarea
          name="description"
          placeholder={t("descriptionPlaceholder")}
          className="min-h-28"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tc("status")}>
          <ComboField name="status" defaultValue="OPERATIONAL" options={statusOpts} />
        </Field>
        <Field label={t("criticality")}>
          <ComboField name="criticality" defaultValue="MEDIUM" options={critOpts} />
        </Field>
        <Field label={tc("owner")}>
          <ComboField
            name="ownerId"
            options={ownerOpts}
            includeNone
            noneLabel={t("noOwner")}
          />
        </Field>
        <Field label={tc("category")}>
          <ComboField
            name="categoryId"
            options={catOpts}
            includeNone
            noneLabel={t("noCategory")}
          />
        </Field>
        <Field label={tc("group")} hint={t("groupHint")}>
          <ComboField
            name="groupId"
            options={teamOpts}
            includeNone
            noneLabel={t("noGroup")}
          />
        </Field>
        <Field label={t("sla")}>
          <ComboField name="slaId" options={slaOpts} includeNone noneLabel={t("noSlaOption")} />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          {t("createService")}
        </Button>
      </div>
    </form>
  );
}
