"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Loader2, Save, RotateCcw, Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveEmailTemplate, resetEmailTemplate } from "@/lib/actions/email-templates";
import { useServerMessage, useT } from "@/lib/i18n/client";

type State = { error?: string; ok?: boolean } | undefined;

export function EmailTemplateEditor({
  templateKey,
  label,
  description,
  vars,
  subject,
  bodyHtml,
  enabled,
  customized,
  previewHtml,
}: {
  templateKey: string;
  label: string;
  description: string;
  vars: string[];
  subject: string;
  bodyHtml: string;
  enabled: boolean;
  customized: boolean;
  previewHtml: string;
}) {
  const [state, action, pending] = useActionState<State, FormData>(saveEmailTemplate, undefined);
  const submit = useFormSubmit(action);
  const wasPending = useRef(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);
  const t = useT("settings");
  const tm = useServerMessage();

  useEffect(() => {
    if (wasPending.current && !pending) {
      if (state?.error) toast.error(tm(state.error));
      else if (state?.ok) toast.success(t("tpl.saved", { label }));
    }
    wasPending.current = pending;
  }, [pending, state, label, t, tm]);

  function insertVar(v: string) {
    const el = bodyRef.current;
    if (!el) return;
    const token = `{{${v}}}`;
    const start = el.selectionStart ?? el.value.length;
    el.value = el.value.slice(0, start) + token + el.value.slice(el.selectionEnd ?? start);
    el.focus();
    el.selectionStart = el.selectionEnd = start + token.length;
  }

  return (
    <div className="grid gap-4 rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{label}</h3>
            {customized ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{t("tpl.customized")}</span>
            ) : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t("tpl.default")}</span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{templateKey}</code>
      </div>

      <form method="post" onSubmit={submit} className="grid gap-3">
        <input type="hidden" name="key" value={templateKey} />

        <label className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">{t("tpl.enabled")}</span>
          <Switch name="enabled" defaultChecked={enabled} />
        </label>

        <div className="grid gap-1.5">
          <Label htmlFor={`subj-${templateKey}`}>{t("tpl.subject")}</Label>
          <Input id={`subj-${templateKey}`} name="subject" defaultValue={subject} />
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor={`body-${templateKey}`}>{t("tpl.body")}</Label>
          <textarea
            id={`body-${templateKey}`}
            name="bodyHtml"
            ref={bodyRef}
            defaultValue={bodyHtml}
            rows={8}
            spellCheck={false}
            className="w-full rounded-lg border bg-background px-3 py-2 font-mono text-xs leading-relaxed shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{t("tpl.variables")}</span>
          {vars.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insertVar(v)}
              className="rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-foreground/80 transition-colors hover:bg-muted"
              title={t("tpl.insert")}
            >
              {`{{${v}}}`}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={pending} size="sm">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t("tpl.save")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setShowPreview((s) => !s)}>
              <Eye className="size-4" /> {showPreview ? t("tpl.hidePreview") : t("tpl.preview")}
            </Button>
          </div>
        </div>
      </form>

      {/* Reset is its own form (non-destructive: drops the override → default). */}
      {customized ? (
        <form action={resetEmailTemplate}>
          <input type="hidden" name="key" value={templateKey} />
          <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
            <RotateCcw className="size-4" /> {t("tpl.resetToDefault")}
          </Button>
        </form>
      ) : null}

      {showPreview ? (
        <div className="overflow-hidden rounded-lg border">
          <div className="border-b bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">{t("tpl.previewSample")}</div>
          <iframe title={`preview-${templateKey}`} sandbox="" srcDoc={previewHtml} className="h-[420px] w-full bg-white" />
        </div>
      ) : null}
    </div>
  );
}
