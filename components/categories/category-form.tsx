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
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{error[0]}</p> : null}
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
  // A category can't be nested under itself.
  const parentOpts: ComboOption[] = parents
    .filter((p) => p.id !== category?.id)
    .map((p) => ({ value: p.id, label: p.name }));
  const teamOpts: ComboOption[] = teams.map((t) => ({ value: t.id, label: t.name }));

  return (
    <form onSubmit={submit} className="grid gap-5">
      {editing ? <input type="hidden" name="id" value={category.id} /> : null}
      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Field label="Name" error={fe.name}>
        <Input name="name" defaultValue={category?.name} placeholder="e.g. Network, Laptop, Access" required />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Parent category"
          error={fe.parentId}
          hint="Nest under an existing category, or leave as a top-level category."
        >
          <ComboField name="parentId" options={parentOpts} defaultValue={category?.parentId ?? undefined} includeNone noneLabel="— Top level —" />
        </Field>

        <Field label="Color" error={fe.color} hint="Hex color for the category dot.">
          <Input name="color" defaultValue={category?.color ?? "#64748b"} placeholder="#64748b" />
        </Field>
      </div>

      <Field label="Icon">
        <IconPicker name="icon" defaultValue={category?.icon ?? "Boxes"} />
      </Field>

      <Field
        label="Handled by (team)"
        error={fe.groupId}
        hint="Optional. Recorded so Sable knows who owns this category — it does not auto-route tickets."
      >
        <ComboField name="groupId" options={teamOpts} defaultValue={category?.groupId ?? undefined} includeNone noneLabel="— No group —" />
      </Field>

      <Field label="Description" error={fe.description}>
        <Textarea
          name="description"
          defaultValue={category?.description ?? ""}
          placeholder="Optional context describing when to use this category…"
          className="min-h-24"
        />
      </Field>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : editing ? <Save className="size-4" /> : <Plus className="size-4" />}
          {editing ? "Save changes" : "Create category"}
        </Button>
      </div>
    </form>
  );
}
