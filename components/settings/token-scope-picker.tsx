"use client";

import { useState } from "react";
import { Combobox, type ComboOption } from "@/components/combobox";
import { API_RESOURCES, resourceScopes, type ApiResource, type ResourceScope } from "@/lib/api-scopes";
import type { TokenPreset } from "@/lib/token-rules";
import { useT } from "@/lib/i18n/client";

const NONE = "none";

/**
 * The scope part of the token form: a preset, or `custom` with one access level
 * per resource. Submits `preset` and, for custom, one `scope` field per picked
 * resource scope (lib/actions/tokens.ts normalises them).
 */
export function TokenScopePicker({ error }: { error?: string }) {
  const t = useT("settings");
  const [preset, setPreset] = useState<TokenPreset>("read");
  const [picked, setPicked] = useState<Partial<Record<ApiResource, ResourceScope>>>({});

  const presetOptions: ComboOption[] = [
    { value: "read", label: t("token.scopeRead") },
    { value: "write", label: t("token.scopeReadWrite") },
    { value: "admin", label: t("token.scopeAdmin") },
    { value: "custom", label: t("token.scopeCustom") },
  ];
  const accessLabel = (scope: ResourceScope) =>
    scope.endsWith(":read") ? t("token.accessRead") : scope === "import:write" ? t("token.accessWrite") : scope === "kb:publish" ? t("token.accessPublish") : t("token.accessReadWrite");

  return (
    <div className="grid gap-3">
      <div className="grid max-w-xs gap-1.5">
        <span className="text-sm font-medium">{t("token.scopes")}</span>
        <Combobox name="preset" options={presetOptions} value={preset} onChange={(v) => setPreset(v as TokenPreset)} />
      </div>
      {preset === "custom" ? (
        <fieldset className="grid gap-3 rounded-lg border p-3">
          <legend className="px-1 text-xs text-muted-foreground">{t("token.customHint")}</legend>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {API_RESOURCES.map((resource) => {
              const options: ComboOption[] = [
                { value: NONE, label: t("token.accessNone") },
                ...resourceScopes(resource).map((s) => ({ value: s, label: accessLabel(s) })),
              ];
              const value = picked[resource] ?? NONE;
              return (
                <div key={resource} className="grid grid-cols-[1fr_10rem] items-center gap-3">
                  <div className="min-w-0">
                    <p className="text-sm">{t(`token.resource.${resource}`)}</p>
                    <p className="text-xs text-muted-foreground">{t(`token.resourceHint.${resource}`)}</p>
                  </div>
                  <Combobox
                    size="sm"
                    options={options}
                    value={value}
                    onChange={(v) => setPicked((prev) => ({ ...prev, [resource]: v === NONE ? undefined : (v as ResourceScope) }))}
                  />
                  {value !== NONE ? <input type="hidden" name="scope" value={value} /> : null}
                </div>
              );
            })}
          </div>
        </fieldset>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
