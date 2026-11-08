"use client";

import { useActionState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Loader2, Plus } from "lucide-react";
import { createAsset, type ActionState } from "@/lib/actions/assets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComboField } from "@/components/combo-field";
import type { ComboOption } from "@/components/combobox";
import {
  ASSET_TYPES,
  ASSET_STATUSES,
  ASSET_TYPE_META,
  ASSET_STATUS_META,
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

const initials = (s: string) => s.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export function AssetForm({
  options, locations,
}: {
  options: FormOptions;
  locations: { value: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createAsset,
    undefined,
  );
  const submit = useFormSubmit(action);
  const fe = state?.fieldErrors ?? {};
  const t = useT("assets");
  const tc = useT("common");
  const te = useEnumT();
  const tm = useServerMessage();

  const typeOpts: ComboOption[] = ASSET_TYPES.map((ty) => ({ value: ty, label: te(ASSET_TYPE_META[ty]), tone: ASSET_TYPE_META[ty].tone, icon: ASSET_TYPE_META[ty].icon }));
  const statusOpts: ComboOption[] = ASSET_STATUSES.map((s) => ({ value: s, label: te(ASSET_STATUS_META[s]), tone: ASSET_STATUS_META[s].tone, icon: ASSET_STATUS_META[s].icon }));
  const ownerOpts: ComboOption[] = options.agents.map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email }));
  const groupOpts: ComboOption[] = options.groups.map((g) => ({ value: g.id, label: g.name }));
  const locationOpts: ComboOption[] = locations.map((l) => ({ value: l.value, label: l.label }));

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tm(state.error)}
        </p>
      ) : null}

      <Field label={tc("name")} error={fe.name}>
        <Input name="name" placeholder={t("form.namePlaceholder")} required />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tc("type")} error={fe.type}>
          <ComboField name="type" defaultValue="SERVER" options={typeOpts} placeholder={tc("type")} />
        </Field>
        <Field label={tc("status")} error={fe.status}>
          <ComboField name="status" defaultValue="IN_USE" options={statusOpts} placeholder={tc("status")} />
        </Field>
        <Field label={t("field.assetTag")} error={fe.assetTag}>
          <Input name="assetTag" placeholder={t("form.assetTagPlaceholder")} />
        </Field>
        <Field label={t("field.serial")} error={fe.serial}>
          <Input name="serial" placeholder={t("form.serialPlaceholder")} />
        </Field>
        <Field label={t("field.model")} error={fe.model}>
          <Input name="model" placeholder={t("form.modelPlaceholder")} />
        </Field>
        <Field label={t("field.manufacturer")} error={fe.manufacturer}>
          <Input name="manufacturer" placeholder={t("form.manufacturerPlaceholder")} />
        </Field>
        <Field label={tc("location")} error={fe.locationId}>
          <ComboField name="locationId" options={locationOpts} includeNone noneLabel={t("noLocation")} placeholder={t("noLocation")} />
        </Field>
        <Field label={t("field.locationNote")} error={fe.location}>
          <Input name="location" placeholder={t("form.locationNotePlaceholder")} />
        </Field>
        <Field label={t("field.ipAddress")} error={fe.ipAddress}>
          <Input name="ipAddress" placeholder={t("form.ipPlaceholder")} />
        </Field>
        <Field label={t("field.os")} error={fe.os}>
          <Input name="os" placeholder={t("form.osPlaceholder")} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tc("owner")}>
          <ComboField name="ownerId" options={ownerOpts} includeNone noneLabel={t("noOwner")} placeholder={tc("unassigned")} />
        </Field>
        <Field label={tc("group")}>
          <ComboField name="groupId" options={groupOpts} includeNone noneLabel={t("noGroup")} placeholder={t("noGroup")} />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          {t("form.create")}
        </Button>
      </div>
    </form>
  );
}
