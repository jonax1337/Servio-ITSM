"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ComboField } from "@/components/combo-field";
import type { ComboOption } from "@/components/combobox";
import { useServerMessage, useT } from "@/lib/i18n/client";

type SettingsActionState = { error?: string; ok?: boolean } | undefined;

export type SettingField =
  | {
      type: "text" | "number" | "password";
      name: string;
      label: string;
      defaultValue?: string;
      placeholder?: string;
      hint?: string;
      /** password: show a "Configured" badge without exposing the value. */
      isSet?: boolean;
    }
  | { type: "switch"; name: string; label: string; defaultChecked?: boolean; hint?: string }
  | {
      type: "select";
      name: string;
      label: string;
      defaultValue?: string;
      options: ComboOption[];
      hint?: string;
    };

export function SettingsForm({
  action,
  fields,
  submitLabel,
}: {
  action: (
    state: SettingsActionState,
    fd: FormData,
  ) => Promise<SettingsActionState>;
  fields: SettingField[];
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState<SettingsActionState, FormData>(
    action,
    undefined,
  );
  const submit = useFormSubmit(formAction);
  const t = useT("settings");
  const tm = useServerMessage();
  const wasPending = useRef(false);

  useEffect(() => {
    if (wasPending.current && !pending) {
      if (state?.error) toast.error(tm(state.error));
      else if (state?.ok) toast.success(t("form.saved"));
    }
    wasPending.current = pending;
  }, [pending, state, t, tm]);

  return (
    <form method="post" onSubmit={submit} className="grid gap-5 rounded-xl border bg-card p-5">
      {fields.map((f) => (
        <div key={f.name} className="grid gap-1.5">
          {f.type === "switch" ? (
            <label className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium">{f.label}</span>
              <Switch name={f.name} defaultChecked={f.defaultChecked} />
            </label>
          ) : f.type === "select" ? (
            <>
              <Label>{f.label}</Label>
              <ComboField
                name={f.name}
                options={f.options}
                defaultValue={f.defaultValue}
              />
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`set-${f.name}`}>{f.label}</Label>
                {f.type === "password" && f.isSet ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    {t("form.configured")}
                  </span>
                ) : null}
              </div>
              <Input
                id={`set-${f.name}`}
                name={f.name}
                type={
                  f.type === "number"
                    ? "number"
                    : f.type === "password"
                      ? "password"
                      : "text"
                }
                defaultValue={f.type === "password" ? "" : f.defaultValue}
                placeholder={
                  f.type === "password" && f.isSet
                    ? t("form.keepPlaceholder")
                    : f.placeholder
                }
                autoComplete={f.type === "password" ? "new-password" : undefined}
              />
            </>
          )}
          {"hint" in f && f.hint ? (
            <p className="text-xs text-muted-foreground">{f.hint}</p>
          ) : null}
        </div>
      ))}
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {submitLabel ?? t("form.saveChanges")}
        </Button>
      </div>
    </form>
  );
}
