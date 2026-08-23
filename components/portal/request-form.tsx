"use client";

import { useActionState, useState } from "react";
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

type Opt = { value: string; label: string };

const TYPE_CARDS = [
  {
    value: "INCIDENT",
    label: "Report an issue",
    hint: "Something is broken or not working.",
    Art: ReportIssueArt,
  },
  {
    value: "REQUEST",
    label: "Request something",
    hint: "Access, hardware, software, or a service.",
    Art: RequestServiceArt,
  },
];

function TypeSelector({ name, defaultValue }: { name: string; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
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
            <span className="mt-1 text-sm font-semibold">{c.label}</span>
            <span className="text-xs text-muted-foreground">{c.hint}</span>
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
  const fe = state?.fieldErrors ?? {};

  const priorityOpts: ComboOption[] = PRIORITIES.map((p) => ({
    value: p,
    label: PRIORITY_META[p].label,
    tone: PRIORITY_META[p].tone,
    icon: PRIORITY_META[p].icon,
  }));
  const defaultTypeValue = TICKET_TYPES.includes(defaultType as (typeof TICKET_TYPES)[number])
    ? defaultType
    : "INCIDENT";

  return (
    <form action={action} className="grid gap-5">
      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="grid gap-2">
        <Label>What can we help with?</Label>
        <TypeSelector name="type" defaultValue={defaultTypeValue} />
      </div>

      <div className="grid gap-1.5">
        <Label>Subject</Label>
        <Input name="title" placeholder="Briefly, what is this about?" required />
        {fe.title ? <p className="text-xs text-destructive">{fe.title[0]}</p> : null}
      </div>

      <div className="grid gap-1.5">
        <Label>Details</Label>
        <Textarea name="description" placeholder="Tell us what happened, any error messages, and when it started…" className="min-h-32" />
      </div>

      <div className="grid gap-1.5">
        <Label>Attachments (optional)</Label>
        <PortalAttachments maxMb={maxMb} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label>Priority</Label>
          <ComboField name="priority" options={priorityOpts} defaultValue="MEDIUM" />
        </div>

        <div className="grid gap-1.5">
          <Label>Related service (optional)</Label>
          <ComboField name="serviceId" options={services} defaultValue={defaultService ?? "none"} includeNone />
        </div>

        <div className="grid gap-1.5 sm:col-span-2">
          <Label>Category (optional)</Label>
          <ComboField name="categoryId" options={categories} defaultValue="none" includeNone />
        </div>
      </div>

      <div className="flex justify-end border-t pt-4">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Submit request
        </Button>
      </div>
    </form>
  );
}
