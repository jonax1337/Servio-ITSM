"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { createReleaseAction, updateReleaseAction } from "@/lib/actions/releases";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/link-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/combo-field";
import type { ComboOption } from "@/components/combobox";
import { initials } from "@/lib/avatar";
import type { FormOptions } from "@/lib/data/options";

export type EditableRelease = {
  id: number;
  name: string;
  description: string | null;
  ownerId: string | null;
  groupId: string | null;
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Creates a release, or edits `release` when given. */
export function ReleaseForm({
  options,
  defaultOwnerId,
  release,
  onSaved,
}: {
  options: FormOptions;
  defaultOwnerId?: string;
  release?: EditableRelease;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ownerOpts: ComboOption[] = options.agents.map((a) => ({
    value: a.id,
    label: a.name ?? a.email,
    avatar: initials(a.name ?? a.email),
    hint: a.email,
  }));
  const groupOpts: ComboOption[] = options.groups.map((g) => ({ value: g.id, label: g.name }));

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError(null);
    start(async () => {
      if (release) {
        formData.set("id", String(release.id));
        const result = await updateReleaseAction(formData);
        if (!result.ok) return setError(result.error ?? "Could not save the release.");
        toast.success("Release updated");
        onSaved?.();
        return;
      }
      const result = await createReleaseAction(formData);
      if (!result.ok) return setError(result.error);
      router.push(`/releases/${result.id}`);
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-5">
      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      <Field label="Name">
        <Input name="name" defaultValue={release?.name} placeholder="e.g. March platform update" required minLength={3} maxLength={120} />
      </Field>

      <Field label="Description" hint="What ships in this release and why.">
        <Textarea name="description" defaultValue={release?.description ?? ""} className="min-h-24" />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Owner">
          <ComboField
            name="ownerId"
            defaultValue={release ? (release.ownerId ?? "none") : defaultOwnerId}
            options={ownerOpts}
            includeNone
            noneLabel="No owner"
          />
        </Field>
        <Field label="Group">
          <ComboField name="groupId" defaultValue={release?.groupId ?? "none"} options={groupOpts} includeNone noneLabel="No group" />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        {release ? null : <LinkButton href="/releases" variant="ghost">Cancel</LinkButton>}
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : release ? <Save className="size-4" /> : <Plus className="size-4" />}
          {release ? "Save changes" : "Create release"}
        </Button>
      </div>
    </form>
  );
}
