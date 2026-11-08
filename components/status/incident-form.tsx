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
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";
import type { EnumTranslator } from "@/lib/i18n/enums";

export type IncidentFormDefaults = {
  id: string;
  title: string;
  summary: string | null;
  impact: string;
  ticketId: number | null;
  serviceIds: string[];
};

const toOptions = (values: readonly string[], meta: typeof STATUS_INCIDENT_STATE_META, te: EnumTranslator): ComboOption[] =>
  values.map((v) => ({ value: v, label: te(meta[v]), tone: meta[v].tone, icon: meta[v].icon }));

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
  const t = useT("status");
  const tc = useT("common");
  const te = useEnumT();
  const tm = useServerMessage();
  const STATE_OPTIONS = toOptions(STATUS_INCIDENT_STATES, STATUS_INCIDENT_STATE_META, te);
  const IMPACT_OPTIONS = toOptions(STATUS_INCIDENT_IMPACTS, STATUS_INCIDENT_IMPACT_META, te);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editing = !!incident;
  const fieldId = useId();
  const initialTicket = incident?.ticketId ? String(incident.ticketId) : defaultTicketId;
  const ticketValue = tickets.some((o) => o.value === initialTicket) ? initialTicket : undefined;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await (editing ? updateStatusIncident : createStatusIncident)(formData);
      if (!result.ok) {
        setError(result.error ? tm(result.error) : tc("somethingWentWrong"));
        return;
      }
      setError(null);
      if (editing) {
        toast.success(t("incidentSaved"));
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
          {t("copyLocked")}
        </p>
      ) : null}

      <Field
        label={t("fieldTitle")}
        htmlFor={`${fieldId}-title`}
        hint={t("titleHint")}
      >
        <Input id={`${fieldId}-title`} name="title" defaultValue={incident?.title} placeholder={t("titlePlaceholder")} required readOnly={copyLocked} />
      </Field>

      <Field label={t("summary")} htmlFor={`${fieldId}-summary`} hint={t("summaryHint")}>
        <Textarea id={`${fieldId}-summary`} name="summary" defaultValue={incident?.summary ?? ""} rows={3} readOnly={copyLocked} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={tc("impact")}>
          <ComboField name="impact" options={IMPACT_OPTIONS} defaultValue={incident?.impact ?? "MINOR"} disabled={copyLocked} />
        </Field>
        {editing ? null : (
          <Field label={t("state")}>
            <ComboField name="state" options={STATE_OPTIONS} defaultValue="INVESTIGATING" />
          </Field>
        )}
      </div>

      <Field label={t("linkedTicket")} hint={t("linkedTicketHint")}>
        <ComboField
          name="ticketId"
          options={tickets}
          defaultValue={ticketValue}
          includeNone
          noneLabel={t("noLinkedTicket")}
        />
      </Field>

      <Field label={t("affectedServices")}>
        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noServices")}</p>
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
          <Field label={t("firstUpdate")} htmlFor={`${fieldId}-update`} hint={t("firstUpdateHint")}>
            <Textarea id={`${fieldId}-update`} name="updateBody" rows={3} placeholder={t("firstUpdatePlaceholder")} />
          </Field>
          {canPublish ? (
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input type="checkbox" name="isPublic" className="mt-0.5 size-4 accent-primary" />
              <span>
                <span className="font-medium">{t("publishImmediately")}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("publishImmediatelyHint")}
                </span>
              </span>
            </label>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
              {t("savedAsDraft")}
            </p>
          )}
        </>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {editing ? tc("saveChanges") : t("createIncident")}
        </Button>
      </div>
    </form>
  );
}
