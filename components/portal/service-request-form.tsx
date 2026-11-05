"use client";

import { useActionState, useState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Loader2, Send, ShieldCheck } from "lucide-react";
import { createCatalogRequest, type CatalogState } from "@/lib/actions/catalog";
import type { ServiceField } from "@/lib/service-forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboOption } from "@/components/combobox";
import { PortalAttachments } from "@/components/portal/portal-attachments";
import { DEFAULT_MAX_UPLOAD_MB } from "@/lib/attachments-ui";

/** Select field for a dynamic catalog form: submits an empty value until chosen,
 * matching the previous <Select name=…> (no auto-selected first option). */
function SelectField({ name, options }: { name: string; options: ComboOption[] }) {
  const [value, setValue] = useState("");
  return (
    <Combobox
      name={name}
      options={options}
      value={value}
      onChange={setValue}
      placeholder="Choose…"
      searchPlaceholder="Search…"
    />
  );
}

export function ServiceRequestForm({
  serviceId,
  fields,
  requiresApproval,
  maxMb = DEFAULT_MAX_UPLOAD_MB,
}: {
  serviceId: string;
  fields: ServiceField[];
  requiresApproval: boolean;
  /** Client-side pre-check mirror of the server's MAX_UPLOAD_MB setting. */
  maxMb?: number;
}) {
  const [state, action, pending] = useActionState<CatalogState, FormData>(createCatalogRequest, undefined);
  const submit = useFormSubmit(action);
  const fe = state?.fieldErrors ?? {};

  return (
    <form onSubmit={submit} className="grid gap-5">
      <input type="hidden" name="catalogItemId" value={serviceId} />

      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {fields.length === 0 ? (
        <div className="grid gap-1.5">
          <Label>Details</Label>
          <Textarea name="f_details" placeholder="Describe what you need…" className="min-h-28" />
        </div>
      ) : (
        fields.map((f) => (
          <div key={f.key} className="grid gap-1.5">
            <Label htmlFor={`f_${f.key}`}>
              {f.label}
              {f.required ? <span className="text-destructive"> *</span> : null}
            </Label>

            {f.type === "textarea" ? (
              <Textarea id={`f_${f.key}`} name={`f_${f.key}`} placeholder={f.placeholder} className="min-h-24" />
            ) : f.type === "select" ? (
              <SelectField name={`f_${f.key}`} options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />
            ) : f.type === "checkbox" ? (
              <div className="flex items-center gap-2 pt-1">
                <Checkbox id={`f_${f.key}`} name={`f_${f.key}`} />
                <Label htmlFor={`f_${f.key}`} className="text-sm font-normal text-muted-foreground">
                  {f.help ?? "Yes"}
                </Label>
              </div>
            ) : (
              <Input
                id={`f_${f.key}`}
                name={`f_${f.key}`}
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                placeholder={f.placeholder}
              />
            )}

            {f.help && f.type !== "checkbox" ? (
              <p className="text-xs text-muted-foreground">{f.help}</p>
            ) : null}
            {fe[f.key] ? <p className="text-xs text-destructive">{fe[f.key]}</p> : null}
          </div>
        ))
      )}

      <div className="grid gap-1.5">
        <Label>Attachments (optional)</Label>
        <PortalAttachments maxMb={maxMb} />
      </div>

      {requiresApproval ? (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          <ShieldCheck className="size-4" /> This request needs manager approval before it&apos;s actioned.
        </p>
      ) : null}

      <div className="flex justify-end border-t pt-4">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Submit request
        </Button>
      </div>
    </form>
  );
}
