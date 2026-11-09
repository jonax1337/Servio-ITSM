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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ComboField } from "@/components/combo-field";
import { MultiCombobox } from "@/components/multi-combobox";
import type { ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

type Person = {
  id: string;
  name: string | null;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  department: string | null;
  secondaryEmails: string[];
  isServiceAccount: boolean;
  canApproveChanges: boolean;
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
  const tm = useServerMessage();
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {errors?.[0] ? <p className="text-xs text-destructive">{tm(errors[0])}</p> : null}
    </div>
  );
}

/** Create a person (no `person`) or edit one's profile. Admin-only; enforced server-side. */
export function PersonDialog({
  person, syncSourceName, groups = [],
}: {
  person?: Person;
  /** Groups a new person can join right away (create only). */
  groups?: ComboOption[];
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
  const t = useT("people");
  const te = useEnumT();
  const tm = useServerMessage();
  const fe = state?.fieldErrors ?? {};
  const [serviceAccount, setServiceAccount] = useState(person?.isServiceAccount ?? false);
  const [canApprove, setCanApprove] = useState(person?.canApproveChanges ?? true);
  const roleOptions: ComboOption[] = ROLES.map((r) => ({
    value: r, label: te(ROLE_META[r]), tone: ROLE_META[r].tone,
  }));

  // Close once, when a new successful result arrives.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state?.ok) setOpen(false);
  }
  // The toast is a side effect, so it runs after commit rather than during render.
  useEffect(() => {
    if (state?.ok) toast.success(editing ? t("personUpdated") : t("personCreated"));
  }, [state, editing, t]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={editing ? "outline" : "default"} size="sm" />}>
        {editing ? <><Pencil className="size-4" /> {t("edit")}</> : <><Plus className="size-4" /> {t("newPerson")}</>}
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t("editPerson") : t("newPerson")}</DialogTitle>
          <DialogDescription>
            {editing ? t("editDescription") : t("newDescription")}
          </DialogDescription>
        </DialogHeader>
        <form method="post" onSubmit={submit} className="grid gap-4">
          {person ? <input type="hidden" name="id" value={person.id} /> : null}
          <input type="hidden" name="isServiceAccount" value={String(serviceAccount)} />
          <input type="hidden" name="canApproveChanges" value={String(!serviceAccount && canApprove)} />

          {syncSourceName ? (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {t.rich("syncManaged", { source: syncSourceName, b: (chunks) => <strong>{chunks}</strong> })}
              </span>
            </p>
          ) : null}

          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{tm(state.error)}</p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("name")} errors={fe.name} className="sm:col-span-2">
              <Input name="name" defaultValue={person?.name ?? ""} required />
            </Field>
            <Field label={t("email")} errors={fe.email} className="sm:col-span-2">
              <Input name="email" type="email" defaultValue={person?.email} required />
            </Field>
            <Field
              label={t("secondaryEmails")}
              errors={fe.secondaryEmails}
              hint={t("secondaryEmailsHint")}
              className="sm:col-span-2"
            >
              <Textarea
                name="secondaryEmails"
                rows={2}
                defaultValue={person?.secondaryEmails.join("\n") ?? ""}
                placeholder="alias@example.com"
              />
            </Field>
            {editing ? null : (
              <Field label={t("role")} errors={fe.role}>
                <ComboField name="role" options={roleOptions} defaultValue="USER" />
              </Field>
            )}
            <Field label={t("phone")} errors={fe.phone}>
              <Input name="phone" defaultValue={person?.phone ?? ""} />
            </Field>
            <Field label={t("jobTitle")} errors={fe.jobTitle}>
              <Input name="jobTitle" defaultValue={person?.jobTitle ?? ""} />
            </Field>
            <Field label={t("department")} errors={fe.department}>
              <Input name="department" defaultValue={person?.department ?? ""} />
            </Field>
            <div className="grid gap-2 rounded-lg border p-3 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={serviceAccount}
                  onCheckedChange={(v) => {
                    setServiceAccount(!!v);
                    setCanApprove(!v); // marking turns the switch off, unmarking turns it on (lib/service-accounts.ts)
                  }}
                />
                {t("serviceAccount")}
              </label>
              <p className="text-xs text-muted-foreground">{t("serviceAccountHint")}</p>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!serviceAccount && canApprove} disabled={serviceAccount} onCheckedChange={(v) => setCanApprove(!!v)} />
                {t("canApproveChanges")}
              </label>
              <p className="text-xs text-muted-foreground">{t("canApproveChangesHint")}</p>
              {fe.canApproveChanges?.[0] ? <p className="text-xs text-destructive">{tm(fe.canApproveChanges[0])}</p> : null}
            </div>
            {editing || groups.length === 0 ? null : (
              <Field label={t("groups")} errors={fe.groupIds} className="sm:col-span-2">
                <MultiCombobox name="groupIds" options={groups} placeholder={t("addToGroups")} searchPlaceholder={t("searchGroups")} />
              </Field>
            )}
            {editing ? null : (
              <Field
                label={t("initialPassword")}
                errors={fe.password}
                hint={t("passwordHint", { min: MIN_PASSWORD_LENGTH })}
                className="sm:col-span-2"
              >
                <Input name="password" type="password" autoComplete="new-password" />
              </Field>
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editing ? t("savePerson") : t("createPerson")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
