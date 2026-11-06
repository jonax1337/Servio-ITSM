"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/combo-field";
import type { ComboOption } from "@/components/combobox";
import { createStatusIncident, updateStatusIncident } from "@/lib/actions/status-incidents";
import {
  STATUS_INCIDENT_IMPACTS,
  STATUS_INCIDENT_IMPACT_META,
  STATUS_INCIDENT_STATES,
  STATUS_INCIDENT_STATE_META,
} from "@/lib/constants";

export type IncidentFormDefaults = {
  id: string;
  title: string;
  summary: string | null;
  impact: string;
  ticketId: number | null;
  serviceIds: string[];
};

const toOptions = (values: readonly string[], meta: typeof STATUS_INCIDENT_STATE_META): ComboOption[] =>
  values.map((v) => ({ value: v, label: meta[v].label, tone: meta[v].tone, icon: meta[v].icon }));

const STATE_OPTIONS = toOptions(STATUS_INCIDENT_STATES, STATUS_INCIDENT_STATE_META);
const IMPACT_OPTIONS = toOptions(STATUS_INCIDENT_IMPACTS, STATUS_INCIDENT_IMPACT_META);

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  /** The id of the text control, so clicking the label focuses it. */
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Create (no `incident`) or edit a status incident. Creating also takes the
 * initial state, a first update and — for managers — "publish now"; after that,
 * state changes go through updates on the detail page.
 */
export function IncidentForm({
  services,
  tickets,
  canPublish,
  incident,
  defaultTicketId,
  copyLocked = false,
  onDone,
}: {
  services: { id: string; name: string }[];
  /** Major-incident tickets the incident can be linked to. */
  tickets: ComboOption[];
  canPublish: boolean;
  incident?: IncidentFormDefaults;
  defaultTicketId?: string;
  /** The incident is public and the editor is no manager: title, summary and impact stay as published. */
  copyLocked?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editing = !!incident;
  const fieldId = useId();
  const initialTicket = incident?.ticketId ? String(incident.ticketId) : defaultTicketId;
  const ticketValue = tickets.some((t) => t.value === initialTicket) ? initialTicket : undefined;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await (editing ? updateStatusIncident : createStatusIncident)(formData);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setError(null);
      if (editing) {
        toast.success("Status incident saved.");
        onDone?.();
        router.refresh();
      } else {
        router.push(`/status/${result.id}`);
      }
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-5">
      {error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {incident ? <input type="hidden" name="id" value={incident.id} /> : null}
      {copyLocked ? (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          This incident is public. Only a manager can change its title, summary or impact; post an update to inform readers.
        </p>
      ) : null}

      <Field
        label="Title"
        htmlFor={`${fieldId}-title`}
        hint="Shown to everyone on the portal once published. Say what is affected, not what is broken internally."
      >
        <Input id={`${fieldId}-title`} name="title" defaultValue={incident?.title} placeholder="e.g. Email delivery delays" required readOnly={copyLocked} />
      </Field>

      <Field label="Summary" htmlFor={`${fieldId}-summary`} hint="Plain-language description for portal users. Leave out internal details.">
        <Textarea id={`${fieldId}-summary`} name="summary" defaultValue={incident?.summary ?? ""} rows={3} readOnly={copyLocked} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Impact">
          <ComboField name="impact" options={IMPACT_OPTIONS} defaultValue={incident?.impact ?? "MINOR"} disabled={copyLocked} />
        </Field>
        {editing ? null : (
          <Field label="State">
            <ComboField name="state" options={STATE_OPTIONS} defaultValue="INVESTIGATING" />
          </Field>
        )}
      </div>

      <Field label="Linked ticket" hint="The major-incident ticket. Portal users who say they are affected are noted on it.">
        <ComboField
          name="ticketId"
          options={tickets}
          defaultValue={ticketValue}
          includeNone
          noneLabel="No linked ticket"
        />
      </Field>

      <Field label="Affected services">
        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground">No services exist yet.</p>
        ) : (
          <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
            {services.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="serviceId"
                  value={s.id}
                  defaultChecked={incident?.serviceIds.includes(s.id)}
                  className="size-4 accent-primary"
                />
                <span className="truncate">{s.name}</span>
              </label>
            ))}
          </div>
        )}
      </Field>

      {editing ? null : (
        <>
          <Field label="First update" htmlFor={`${fieldId}-update`} hint="Optional. Becomes the first entry in the timeline.">
            <Textarea id={`${fieldId}-update`} name="updateBody" rows={3} placeholder="What do we know so far?" />
          </Field>
          {canPublish ? (
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input type="checkbox" name="isPublic" className="mt-0.5 size-4 accent-primary" />
              <span>
                <span className="font-medium">Publish immediately</span>
                <span className="block text-xs text-muted-foreground">
                  Otherwise it is saved as a draft that only staff can see.
                </span>
              </span>
            </label>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              Saved as a draft that only staff can see. A manager publishes it.
            </p>
          )}
        </>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {editing ? "Save changes" : "Create incident"}
        </Button>
      </div>
    </form>
  );
}
