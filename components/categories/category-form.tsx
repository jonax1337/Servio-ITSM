"use client";

import { useActionState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Loader2, Plus, Save } from "lucide-react";
import { createCategory, updateCategory, type ActionState } from "@/lib/actions/categories";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/combo-field";
import { IconPicker } from "@/components/icon-picker";
import type { ComboOption } from "@/components/combobox";
import { useServerMessage, useT } from "@/lib/i18n/client";

export type ParentOption = { id: string; name: string };
export type TeamOption = { id: string; name: string };
export type CategoryData = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  parentId: string | null;
  groupId: string | null;
};

function Field({
  label, error, children, hint,
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

export function CategoryForm({
  parents,
  teams,
  category,
}: {
  parents: ParentOption[];
  teams: TeamOption[];
  category?: CategoryData;
}) {
  const editing = !!category;
  const [state, action, pending] = useActionState<ActionState, FormData>(
    editing ? updateCategory : createCategory,
    undefined,
  );
  const submit = useFormSubmit(action);
  const fe = state?.fieldErrors ?? {};
  const t = useT("categories");
  const tc = useT("common");
  const tm = useServerMessage();
  // A category can't be nested under itself.
  const parentOpts: ComboOption[] = parents
    .filter((p) => p.id !== category?.id)
    .map((p) => ({ value: p.id, label: p.name }));
  const teamOpts: ComboOption[] = teams.map((team) => ({ value: team.id, label: team.name }));

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      {editing ? <input type="hidden" name="id" value={category.id} /> : null}
      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tm(state.error)}
        </p>
      ) : null}

      <Field label={tc("name")} error={fe.name}>
        <Input name="name" defaultValue={category?.name} placeholder={t("form.namePlaceholder")} required />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label={t("form.parent")}
          error={fe.parentId}
          hint={t("form.parentHint")}
        >
          <ComboField name="parentId" options={parentOpts} defaultValue={category?.parentId ?? undefined} includeNone noneLabel={t("form.topLevel")} />
        </Field>

        <Field label={t("form.color")} error={fe.color} hint={t("form.colorHint")}>
          <Input name="color" defaultValue={category?.color ?? "#64748b"} placeholder="#64748b" />
        </Field>
      </div>

      <Field label={t("form.icon")}>
        <IconPicker name="icon" defaultValue={category?.icon ?? "Boxes"} />
      </Field>

      <Field
        label={t("form.team")}
        error={fe.groupId}
        hint={t("form.teamHint")}
      >
        <ComboField name="groupId" options={teamOpts} defaultValue={category?.groupId ?? undefined} includeNone noneLabel={t("form.noGroup")} />
      </Field>

      <Field label={tc("description")} error={fe.description}>
        <Textarea
          name="description"
          defaultValue={category?.description ?? ""}
          placeholder={t("form.descriptionPlaceholder")}
          className="min-h-24"
        />
      </Field>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : editing ? <Save className="size-4" /> : <Plus className="size-4" />}
          {editing ? tc("saveChanges") : t("form.create")}
        </Button>
      </div>
    </form>
  );
}
