"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { setCustomFieldValue } from "@/lib/actions/custom-fields";
import { parseOptions, type CustomFieldDef, type CustomFieldType } from "@/lib/custom-fields";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboOption } from "@/components/combobox";
import { useT } from "@/lib/i18n/client";

// One editable custom-field control. On change it fires the server action via a
// transition so the value persists without a full form submit.
export function CustomFieldInput({
  entityType,
  entityId,
  def,
  value,
  disabled,
}: {
  entityType: string;
  entityId: number;
  def: CustomFieldDef;
  value: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const t = useT("settings");
  const [draft, setDraft] = useState(value);
  const type = def.type as CustomFieldType;

  function persist(next: string) {
    const fd = new FormData();
    fd.set("entityType", entityType);
    fd.set("id", String(entityId));
    fd.set("key", def.key);
    fd.set("value", next);
    start(() => setCustomFieldValue(fd));
  }

  // Commit text/number/date on blur (or Enter); commit select/checkbox immediately.
  const commit = () => {
    if (draft !== value) persist(draft);
  };

  const selectOptions: ComboOption[] = parseOptions(def.options).map((o) => ({ value: o, label: o }));

  return (
    <div className="grid gap-1.5">
      {type !== "checkbox" ? (
        <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {def.label}
          {def.required ? <span className="text-destructive">*</span> : null}
          {pending ? <Loader2 className="size-3 animate-spin" /> : null}
        </label>
      ) : null}

      {type === "text" || type === "number" || type === "date" ? (
        <Input
          type={type === "number" ? "number" : type === "date" ? "date" : "text"}
          value={draft}
          disabled={disabled || pending}
          placeholder={def.placeholder ?? undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      ) : null}

      {type === "textarea" ? (
        <Textarea
          value={draft}
          disabled={disabled || pending}
          placeholder={def.placeholder ?? undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          className="min-h-14"
        />
      ) : null}

      {type === "select" ? (
        <Combobox
          options={selectOptions}
          value={draft}
          size="sm"
          disabled={disabled}
          pending={pending}
          placeholder={def.placeholder ?? t("cfInput.select")}
          onChange={(v) => {
            setDraft(v);
            persist(v);
          }}
        />
      ) : null}

      {type === "checkbox" ? (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={draft === "true"}
            disabled={disabled || pending}
            onCheckedChange={(c) => {
              const next = c ? "true" : "";
              setDraft(next);
              persist(next);
            }}
          />
          <span className="flex items-center gap-1.5">
            {def.label}
            {pending ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
          </span>
        </label>
      ) : null}

      {def.help ? <p className="text-xs text-muted-foreground">{def.help}</p> : null}
    </div>
  );
}
