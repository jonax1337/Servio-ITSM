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

export function AssetForm({ options }: { options: FormOptions }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    createAsset,
    undefined,
  );
  const submit = useFormSubmit(action);
  const fe = state?.fieldErrors ?? {};

  const typeOpts: ComboOption[] = ASSET_TYPES.map((t) => ({ value: t, label: ASSET_TYPE_META[t].label, tone: ASSET_TYPE_META[t].tone, icon: ASSET_TYPE_META[t].icon }));
  const statusOpts: ComboOption[] = ASSET_STATUSES.map((s) => ({ value: s, label: ASSET_STATUS_META[s].label, tone: ASSET_STATUS_META[s].tone, icon: ASSET_STATUS_META[s].icon }));
  const ownerOpts: ComboOption[] = options.agents.map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email }));
  const groupOpts: ComboOption[] = options.groups.map((g) => ({ value: g.id, label: g.name }));

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Field label="Name" error={fe.name}>
        <Input name="name" placeholder="e.g. web-prod-01" required />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Type" error={fe.type}>
          <ComboField name="type" defaultValue="SERVER" options={typeOpts} placeholder="Type" />
        </Field>
        <Field label="Status" error={fe.status}>
          <ComboField name="status" defaultValue="IN_USE" options={statusOpts} placeholder="Status" />
        </Field>
        <Field label="Asset tag" error={fe.assetTag}>
          <Input name="assetTag" placeholder="e.g. AST-0001" />
        </Field>
        <Field label="Serial" error={fe.serial}>
          <Input name="serial" placeholder="Serial number" />
        </Field>
        <Field label="Model" error={fe.model}>
          <Input name="model" placeholder="e.g. PowerEdge R740" />
        </Field>
        <Field label="Manufacturer" error={fe.manufacturer}>
          <Input name="manufacturer" placeholder="e.g. Dell" />
        </Field>
        <Field label="Location" error={fe.location}>
          <Input name="location" placeholder="e.g. DC1 · Rack 12" />
        </Field>
        <Field label="IP address" error={fe.ipAddress}>
          <Input name="ipAddress" placeholder="e.g. 10.0.4.21" />
        </Field>
        <Field label="Operating system" error={fe.os}>
          <Input name="os" placeholder="e.g. Ubuntu 22.04 LTS" />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Owner">
          <ComboField name="ownerId" options={ownerOpts} includeNone noneLabel="No owner" placeholder="Unassigned" />
        </Field>
        <Field label="Group">
          <ComboField name="groupId" options={groupOpts} includeNone noneLabel="No group" placeholder="No group" />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          Create asset
        </Button>
      </div>
    </form>
  );
}
