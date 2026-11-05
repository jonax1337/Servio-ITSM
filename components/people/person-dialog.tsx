"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus, Pencil, Loader2, Save, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { createPerson, updatePerson, type PersonState } from "@/lib/actions/people";
import { ROLES, ROLE_META } from "@/lib/constants";
import { MIN_PASSWORD_LENGTH } from "@/lib/person-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ComboField } from "@/components/combo-field";
import type { ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

type Person = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  department: string | null;
};

function Field({
  label, errors, hint, className, children,
}: {
  label: string;
  errors?: string[];
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {errors?.[0] ? <p className="text-xs text-destructive">{errors[0]}</p> : null}
    </div>
  );
}

const roleOptions: ComboOption[] = ROLES.map((r) => ({
  value: r, label: ROLE_META[r].label, tone: ROLE_META[r].tone,
}));

/** Create a person (no `person`) or edit one's profile. Admin-only; enforced server-side. */
export function PersonDialog({
  person, syncSourceName,
}: {
  person?: Person;
  /** Set when the person is managed by a sync source, whose next run may overwrite edits. */
  syncSourceName?: string | null;
}) {
  const editing = !!person;
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<PersonState, FormData>(
    editing ? updatePerson : createPerson,
    undefined,
  );
  const submit = useFormSubmit(action);
  const fe = state?.fieldErrors ?? {};

  // Close once, when a new successful result arrives.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state?.ok) setOpen(false);
  }
  // The toast is a side effect, so it runs after commit rather than during render.
  useEffect(() => {
    if (state?.ok) toast.success(editing ? "Person updated" : "Person created");
  }, [state, editing]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={editing ? "outline" : "default"} size="sm" />}>
        {editing ? <><Pencil className="size-4" /> Edit</> : <><Plus className="size-4" /> New person</>}
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit person" : "New person"}</DialogTitle>
          <DialogDescription>
            {editing ? "Update contact and job details." : "Add a person who can raise or work on tickets."}
          </DialogDescription>
        </DialogHeader>
        <form method="post" onSubmit={submit} className="grid gap-4">
          {person ? <input type="hidden" name="id" value={person.id} /> : null}

          {syncSourceName ? (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                This person is managed by the sync source <strong>{syncSourceName}</strong>. Fields it provides
                (name, email, phone, job title, department) may be overwritten on its next run.
              </span>
            </p>
          ) : null}

          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" errors={fe.name} className="sm:col-span-2">
              <Input name="name" defaultValue={person?.name ?? ""} required />
            </Field>
            <Field label="Email" errors={fe.email} className="sm:col-span-2">
              <Input name="email" type="email" defaultValue={person?.email} required />
            </Field>
            {editing ? null : (
              <Field label="Role" errors={fe.role}>
                <ComboField name="role" options={roleOptions} defaultValue="USER" />
              </Field>
            )}
            <Field label="Phone" errors={fe.phone}>
              <Input name="phone" defaultValue={person?.phone ?? ""} />
            </Field>
            <Field label="Job title" errors={fe.jobTitle}>
              <Input name="jobTitle" defaultValue={person?.jobTitle ?? ""} />
            </Field>
            <Field label="Department" errors={fe.department}>
              <Input name="department" defaultValue={person?.department ?? ""} />
            </Field>
            {editing ? null : (
              <Field
                label="Initial password (optional)"
                errors={fe.password}
                hint={`At least ${MIN_PASSWORD_LENGTH} characters. Leave empty if this person signs in through SSO or a directory.`}
                className="sm:col-span-2"
              >
                <Input name="password" type="password" autoComplete="new-password" />
              </Field>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editing ? "Save person" : "Create person"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
