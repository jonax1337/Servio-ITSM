"use client";

import { useActionState } from "react";
import { serviceLabel } from "@/lib/service-label";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Loader2, Plus } from "lucide-react";
import { createTicket, type ActionState } from "@/lib/actions/tickets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/combo-field";
import { FormCustomFields } from "@/components/custom-fields/form-custom-fields";
import type { ComboOption } from "@/components/combobox";
import type { CustomFieldDef } from "@/lib/custom-fields";
import {
  TICKET_TYPES, PRIORITIES, IMPACT_URGENCY,
  TICKET_TYPE_META, PRIORITY_META, LEVEL_META,
} from "@/lib/constants";
import type { FormOptions } from "@/lib/data/options";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

type UserOpt = { id: string; name: string | null; email: string };

function Field({
  label, error, hint, children,
}: { label: string; error?: string[]; hint?: string; children: React.ReactNode }) {
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

export function TicketForm({
  options, requesters, currentUserId, customFieldDefs = [],
}: {
  options: FormOptions;
  requesters: UserOpt[];
  currentUserId: string;
  customFieldDefs?: CustomFieldDef[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createTicket, undefined);
  const submit = useFormSubmit(action);
  const fe = state?.fieldErrors ?? {};
  const t = useT("tickets");
  const tc = useT("common");
  const te = useEnumT();
  const tm = useServerMessage();

  const typeOpts: ComboOption[] = TICKET_TYPES.map((v) => ({ value: v, label: te(TICKET_TYPE_META, v), tone: TICKET_TYPE_META[v].tone, icon: TICKET_TYPE_META[v].icon }));
  const prioOpts: ComboOption[] = PRIORITIES.map((p) => ({ value: p, label: te(PRIORITY_META, p), tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon }));
  const levelOpts: ComboOption[] = IMPACT_URGENCY.map((l) => ({ value: l, label: te(LEVEL_META, l), tone: LEVEL_META[l].tone }));
  const userOpts: ComboOption[] = requesters.map((u) => ({ value: u.id, label: u.name ?? u.email, avatar: initials(u.name ?? u.email), hint: u.email }));
  const agentOpts: ComboOption[] = options.agents.map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email }));
  const groupOpts: ComboOption[] = options.groups.map((g) => ({ value: g.id, label: g.name }));
  const catOpts: ComboOption[] = options.categories.map((c) => ({ value: c.id, label: c.name }));
  const svcOpts: ComboOption[] = options.services.map((s) => ({ value: s.id, label: serviceLabel(s) }));

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tm(state.error)}
        </p>
      ) : null}

      <Field label={t("form.subject")} error={fe.title}>
        <Input name="title" placeholder={t("form.subjectPlaceholder")} required />
      </Field>

      <Field label={tc("description")} error={fe.description}>
        <Textarea name="description" placeholder={t("form.descriptionPlaceholder")} className="min-h-32" />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tc("type")}><ComboField name="type" defaultValue="INCIDENT" options={typeOpts} /></Field>
        <Field label={tc("priority")}><ComboField name="priority" defaultValue="MEDIUM" options={prioOpts} /></Field>
        <Field label={tc("impact")}><ComboField name="impact" defaultValue="MEDIUM" options={levelOpts} /></Field>
        <Field label={tc("urgency")}><ComboField name="urgency" defaultValue="MEDIUM" options={levelOpts} /></Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tc("requester")} error={fe.requesterId} hint={t("form.requesterHint")}>
          <ComboField
            name="requesterId"
            defaultValue={requesters.some((r) => r.id === currentUserId) ? currentUserId : requesters[0]?.id}
            options={userOpts}
            placeholder={t("form.requesterPlaceholder")}
          />
        </Field>
        <Field label={t("form.requestedBy")} hint={t("form.requestedByHint")}>
          <ComboField name="requestedByUserId" options={userOpts} includeNone noneLabel={t("form.theRequester")} placeholder={t("form.requestedByPlaceholder")} />
        </Field>
        <Field label={tc("assignee")}>
          <ComboField name="assigneeId" defaultValue={currentUserId} options={agentOpts} includeNone noneLabel={tc("unassigned")} />
        </Field>
        <Field label={tc("group")}><ComboField name="groupId" options={groupOpts} includeNone noneLabel={t("form.noGroup")} /></Field>
        <Field label={tc("category")}><ComboField name="categoryId" options={catOpts} includeNone noneLabel={t("form.noCategory")} /></Field>
        <Field label={tc("service")}><ComboField name="serviceId" options={svcOpts} includeNone noneLabel={t("form.noService")} /></Field>
      </div>

      {customFieldDefs.length > 0 ? (
        <div className="grid gap-3">
          <p className="text-sm font-medium">{t("form.customFields")}</p>
          <FormCustomFields defs={customFieldDefs} disabled={pending} />
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {t("form.create")}
        </Button>
      </div>
    </form>
  );
}
