"use client";

import { useActionState, useState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Send, Loader2 } from "lucide-react";
import { createPortalTicket, type PortalState } from "@/lib/actions/portal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/combo-field";
import type { ComboOption } from "@/components/combobox";
import { PortalAttachments } from "@/components/portal/portal-attachments";
import { DEFAULT_MAX_UPLOAD_MB } from "@/lib/attachments-ui";
import { ReportIssueArt, RequestServiceArt } from "@/components/portal/illustrations";
import { cn } from "@/lib/utils";
import { TICKET_TYPES, PRIORITIES, PRIORITY_META } from "@/lib/constants";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

type Opt = { value: string; label: string };

const TYPE_CARDS = [
  { value: "INCIDENT", label: "type.incident", hint: "type.incidentHint", Art: ReportIssueArt },
  { value: "REQUEST", label: "type.request", hint: "type.requestHint", Art: RequestServiceArt },
] as const;

function TypeSelector({ name, defaultValue }: { name: string; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const t = useT("portal");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name={name} value={value} />
      {TYPE_CARDS.map((c) => {
        const on = value === c.value;
        return (
          <button
            key={c.value}
            type="button"
            aria-pressed={on}
            onClick={() => setValue(c.value)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-2xl border p-4 text-center transition-colors",
              on
                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                : "hover:border-primary/40 hover:bg-muted/30",
            )}
          >
            <c.Art className="h-16 w-24" />
            <span className="mt-1 text-sm font-semibold">{t(c.label)}</span>
            <span className="text-xs text-muted-foreground">{t(c.hint)}</span>
          </button>
        );
      })}
    </div>
  );
}

export function RequestForm({
  categories, services, defaultType, defaultService, maxMb = DEFAULT_MAX_UPLOAD_MB,
}: {
  categories: Opt[];
  services: Opt[];
  defaultType: string;
  defaultService?: string;
  /** Client-side pre-check mirror of the server's MAX_UPLOAD_MB setting. */
  maxMb?: number;
}) {
  const [state, action, pending] = useActionState<PortalState, FormData>(createPortalTicket, undefined);
  const submit = useFormSubmit(action);
  const t = useT("portal");
  const te = useEnumT();
  const tm = useServerMessage();
  const fe = tm.fields(state?.fieldErrors) ?? {};

  const priorityOpts: ComboOption[] = PRIORITIES.map((p) => ({
    value: p,
    label: te(PRIORITY_META[p]),
    tone: PRIORITY_META[p].tone,
    icon: PRIORITY_META[p].icon,
  }));
  const defaultTypeValue = TICKET_TYPES.includes(defaultType as (typeof TICKET_TYPES)[number])
    ? defaultType
    : "INCIDENT";

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tm(state.error)}
        </p>
      ) : null}

      <div className="grid gap-2">
        <Label>{t("whatCanWeHelp")}</Label>
        <TypeSelector name="type" defaultValue={defaultTypeValue} />
      </div>

      <div className="grid gap-1.5">
        <Label>{t("subject")}</Label>
        <Input name="title" placeholder={t("subjectPlaceholder")} required />
        {fe.title ? <p className="text-xs text-destructive">{fe.title[0]}</p> : null}
      </div>

      <div className="grid gap-1.5">
        <Label>{t("details")}</Label>
        <Textarea name="description" placeholder={t("detailsPlaceholder")} className="min-h-32" />
      </div>

      <div className="grid gap-1.5">
        <Label>{t("attachmentsOptional")}</Label>
        <PortalAttachments maxMb={maxMb} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>{t("priority")}</Label>
          <ComboField name="priority" options={priorityOpts} defaultValue="MEDIUM" />
        </div>

        <div className="grid gap-1.5">
          <Label>{t("relatedServiceOptional")}</Label>
          <ComboField name="serviceId" options={services} defaultValue={defaultService ?? "none"} includeNone />
        </div>

        <div className="grid gap-1.5 sm:col-span-2">
          <Label>{t("categoryOptional")}</Label>
          <ComboField name="categoryId" options={categories} defaultValue="none" includeNone />
        </div>
      </div>

      <div className="flex justify-end border-t pt-4">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {t("submitRequest")}
        </Button>
      </div>
    </form>
  );
}
