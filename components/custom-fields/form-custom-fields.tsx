"use client";

import { useState } from "react";
import { parseOptions, type CustomFieldDef, type CustomFieldType } from "@/lib/custom-fields";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/combobox";
import { useT } from "@/lib/i18n/client";

/**
 * Plain form inputs for an entity's custom fields inside a CREATE form. Values
 * post as `cf_<key>` entries, which the create actions collect, validate and
 * persist into the entity's `customFields` JSON (mirrors the ticket flow).
 *
 * Unlike CustomFieldInput (detail pages), nothing persists on change — the
 * entity doesn't exist yet; the whole form submits together. Text-like inputs
 * submit natively via their `name`; the controlled controls (select/checkbox)
 * carry a hidden input so their value rides the same submit. All ACTIVE defs
 * render here; visibility conditions are re-checked server-side against the
 * submitted built-in values at enforcement time.
 */
export function FormCustomFields({
  defs,
  disabled,
}: {
  defs: CustomFieldDef[];
  disabled?: boolean;
}) {
  const [selectValues, setSelectValues] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const t = useT("settings");
  if (defs.length === 0) return null;

  return (
    <div className="grid gap-3">
      {defs.map((def) => {
        const type = def.type as CustomFieldType;
        const name = `cf_${def.key}`;
        return (
          <div key={def.id} className="grid gap-1.5">
            {type !== "checkbox" ? (
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {def.label}
                {def.required ? <span className="text-destructive">*</span> : null}
              </label>
            ) : null}

            {type === "text" || type === "number" || type === "date" ? (
              <Input
                type={type === "number" ? "number" : type === "date" ? "date" : "text"}
                name={name}
                disabled={disabled}
                placeholder={def.placeholder ?? undefined}
              />
            ) : null}

            {type === "textarea" ? (
              <Textarea
                name={name}
                disabled={disabled}
                placeholder={def.placeholder ?? undefined}
                className="min-h-14"
              />
            ) : null}

            {type === "select" ? (
              <>
                <input type="hidden" name={name} value={selectValues[def.key] ?? ""} />
                <Combobox
                  options={parseOptions(def.options).map((o) => ({ value: o, label: o }))}
                  value={selectValues[def.key] ?? null}
                  size="sm"
                  disabled={disabled}
                  placeholder={def.placeholder ?? t("cfInput.select")}
                  onChange={(v) => setSelectValues((prev) => ({ ...prev, [def.key]: v }))}
                />
              </>
            ) : null}

            {type === "checkbox" ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="hidden"
                  name={name}
                  value={checked[def.key] ? "true" : ""}
                />
                <Checkbox
                  checked={!!checked[def.key]}
                  disabled={disabled}
                  onCheckedChange={(c) => setChecked((prev) => ({ ...prev, [def.key]: !!c }))}
                />
                <span>{def.label}</span>
              </label>
            ) : null}

            {def.help ? <p className="text-xs text-muted-foreground">{def.help}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
