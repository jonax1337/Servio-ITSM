"use client";

import { useActionState, useState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Loader2, Send, ShieldCheck } from "lucide-react";
import { createCatalogRequest, type CatalogState } from "@/lib/actions/catalog";
import { FORM_URGENCY_LEVELS, visibleFields, type ServiceField } from "@/lib/service-forms";
import { LEVEL_META } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboOption } from "@/components/combobox";
import { PortalAttachments } from "@/components/portal/portal-attachments";
import { DEFAULT_MAX_UPLOAD_MB } from "@/lib/attachments-ui";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

/** Select field for a dynamic catalog form: submits an empty value until chosen,
 * matching the previous <Select name=…> (no auto-selected first option). */
function SelectField({ name, options, onValueChange }: { name: string; options: ComboOption[]; onValueChange?: (value: string) => void }) {
  const [value, setValue] = useState("");
  const t = useT("portal");
  return (
    <Combobox
      name={name}
      options={options}
      value={value}
      onChange={(v) => {
        setValue(v);
        onValueChange?.(v);
      }}
      placeholder={t("choose")}
      searchPlaceholder={t("search")}
    />
  );
}

/** Multiple choice: one checkbox per option, submitted as a JSON array. */
function MultiSelectField({ name, options, onValueChange }: { name: string; options: string[]; onValueChange?: (picked: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (o: string, on: boolean) => {
    const next = on ? [...picked.filter((x) => x !== o), o] : picked.filter((x) => x !== o);
    setPicked(next);
    onValueChange?.(next);
  };
  return (
    <div className="grid gap-1.5 pt-1">
      <input type="hidden" name={name} value={JSON.stringify(picked)} />
      {options.map((o) => (
        <label key={o} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={picked.includes(o)}
            onCheckedChange={(v) => toggle(o, !!v)}
          />
          {o}
        </label>
      ))}
    </div>
  );
}

export function ServiceRequestForm({
  serviceId,
  fields,
  requiresApproval,
  ownAssets = [],
  maxMb = DEFAULT_MAX_UPLOAD_MB,
}: {
  serviceId: string;
  fields: ServiceField[];
  requiresApproval: boolean;
  /** The requester's own devices, for "own device" questions. */
  ownAssets?: ComboOption[];
  /** Client-side pre-check mirror of the server's MAX_UPLOAD_MB setting. */
  maxMb?: number;
}) {
  const [state, action, pending] = useActionState<CatalogState, FormData>(createCatalogRequest, undefined);
  const submit = useFormSubmit(action);
  const t = useT("portal");
  const tm = useServerMessage();
  const te = useEnumT();
  const fe = state?.fieldErrors ?? {};
  const urgencyOpts: ComboOption[] = FORM_URGENCY_LEVELS.map((l) => ({ value: l, label: te(LEVEL_META, l) }));
  // Answers of the questions others depend on; a conditional question is only
  // rendered (and so only submitted and required) while its condition holds.
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const setAnswer = (key: string) => (value: unknown) => setAnswers((a) => ({ ...a, [key]: value }));
  const shown = visibleFields(fields, answers);

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      <input type="hidden" name="catalogItemId" value={serviceId} />

      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tm(state.error)}
        </p>
      ) : null}

      {fields.length === 0 ? (
        <div className="grid gap-1.5">
          <Label>{t("details")}</Label>
          <Textarea name="f_details" placeholder={t("describeNeed")} className="min-h-28" />
        </div>
      ) : (
        shown.map((f) => (
          <div key={f.key} className="grid gap-1.5">
            <Label htmlFor={`f_${f.key}`}>
              {f.label}
              {f.required ? <span className="text-destructive"> *</span> : null}
            </Label>

            {f.type === "textarea" ? (
              <Textarea id={`f_${f.key}`} name={`f_${f.key}`} placeholder={f.placeholder} className="min-h-24" />
            ) : f.type === "select" ? (
              <SelectField name={`f_${f.key}`} options={(f.options ?? []).map((o) => ({ value: o, label: o }))} onValueChange={setAnswer(f.key)} />
            ) : f.type === "multiselect" ? (
              <MultiSelectField name={`f_${f.key}`} options={f.options ?? []} onValueChange={setAnswer(f.key)} />
            ) : f.type === "urgency" ? (
              <SelectField name={`f_${f.key}`} options={urgencyOpts} onValueChange={setAnswer(f.key)} />
            ) : f.type === "asset" ? (
              ownAssets.length > 0 ? (
                <SelectField name={`f_${f.key}`} options={ownAssets} />
              ) : (
                <p className="text-sm text-muted-foreground">{t("noOwnDevices")}</p>
              )
            ) : f.type === "people" ? (
              <Input id={`f_${f.key}`} name={`f_${f.key}`} type="text" placeholder={f.placeholder || t("peoplePlaceholder")} autoComplete="off" />
            ) : f.type === "checkbox" ? (
              <div className="flex items-center gap-2 pt-1">
                <Checkbox id={`f_${f.key}`} name={`f_${f.key}`} onCheckedChange={(v) => setAnswer(f.key)(!!v)} />
                <Label htmlFor={`f_${f.key}`} className="text-sm font-normal text-muted-foreground">
                  {f.help ?? t("yes")}
                </Label>
              </div>
            ) : (
              <Input
                id={`f_${f.key}`}
                name={`f_${f.key}`}
                type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : "text"}
                placeholder={f.placeholder}
              />
            )}

            {f.help && f.type !== "checkbox" ? (
              <p className="text-xs text-muted-foreground">{f.help}</p>
            ) : null}
            {fe[f.key] ? <p className="text-xs text-destructive">{tm(String(fe[f.key]))}</p> : null}
          </div>
        ))
      )}

      <div className="grid gap-1.5">
        <Label>{t("attachmentsOptional")}</Label>
        <PortalAttachments maxMb={maxMb} />
      </div>

      {requiresApproval ? (
        <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-600 dark:text-amber-400">
          <ShieldCheck className="size-4" /> {t("needsApproval")}
        </p>
      ) : null}

      <div className="flex justify-end border-t pt-4">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {t("submitRequest")}
        </Button>
      </div>
    </form>
  );
}
