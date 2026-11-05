"use client";

import { useActionState } from "react";
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

type UserOpt = { id: string; name: string | null; email: string };

function Field({
  label, error, hint, children,
}: { label: string; error?: string[]; hint?: string; children: React.ReactNode }) {
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

  const typeOpts: ComboOption[] = TICKET_TYPES.map((t) => ({ value: t, label: TICKET_TYPE_META[t].label, tone: TICKET_TYPE_META[t].tone, icon: TICKET_TYPE_META[t].icon }));
  const prioOpts: ComboOption[] = PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label, tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon }));
  const levelOpts: ComboOption[] = IMPACT_URGENCY.map((l) => ({ value: l, label: LEVEL_META[l].label, tone: LEVEL_META[l].tone }));
  const userOpts: ComboOption[] = requesters.map((u) => ({ value: u.id, label: u.name ?? u.email, avatar: initials(u.name ?? u.email), hint: u.email }));
  const agentOpts: ComboOption[] = options.agents.map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email }));
  const groupOpts: ComboOption[] = options.groups.map((g) => ({ value: g.id, label: g.name }));
  const catOpts: ComboOption[] = options.categories.map((c) => ({ value: c.id, label: c.name }));
  const svcOpts: ComboOption[] = options.services.map((s) => ({ value: s.id, label: s.name }));

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Field label="Subject" error={fe.title}>
        <Input name="title" placeholder="Short summary of the issue or request" required />
      </Field>

      <Field label="Description" error={fe.description}>
        <Textarea name="description" placeholder="Describe the problem, steps to reproduce, impact…" className="min-h-32" />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Type"><ComboField name="type" defaultValue="INCIDENT" options={typeOpts} /></Field>
        <Field label="Priority"><ComboField name="priority" defaultValue="MEDIUM" options={prioOpts} /></Field>
        <Field label="Impact"><ComboField name="impact" defaultValue="MEDIUM" options={levelOpts} /></Field>
        <Field label="Urgency"><ComboField name="urgency" defaultValue="MEDIUM" options={levelOpts} /></Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Requester" error={fe.requesterId} hint="Who the ticket is for.">
          <ComboField
            name="requesterId"
            defaultValue={requesters.some((r) => r.id === currentUserId) ? currentUserId : requesters[0]?.id}
            options={userOpts}
            placeholder="Who it's for"
          />
        </Field>
        <Field label="Requested by" hint="If someone raised this on behalf of the requester.">
          <ComboField name="requestedByUserId" options={userOpts} includeNone noneLabel="— The requester —" placeholder="On behalf of the requester" />
        </Field>
        <Field label="Assignee">
          <ComboField name="assigneeId" defaultValue={currentUserId} options={agentOpts} includeNone noneLabel="Unassigned" />
        </Field>
        <Field label="Group"><ComboField name="groupId" options={groupOpts} includeNone noneLabel="No group" /></Field>
        <Field label="Category"><ComboField name="categoryId" options={catOpts} includeNone noneLabel="No category" /></Field>
        <Field label="Service"><ComboField name="serviceId" options={svcOpts} includeNone noneLabel="No service" /></Field>
      </div>

      {customFieldDefs.length > 0 ? (
        <div className="grid gap-3">
          <p className="text-sm font-medium">Custom fields</p>
          <FormCustomFields defs={customFieldDefs} disabled={pending} />
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Create ticket
        </Button>
      </div>
    </form>
  );
}
