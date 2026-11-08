"use client";

import { useActionState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Loader2, Save } from "lucide-react";
import type { ArticleState } from "@/lib/actions/knowledge";
import { renderMarkdown } from "@/lib/markdown";
import { ARTICLE_VISIBILITY_META } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { ComboField } from "@/components/combo-field";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

type Action = (prev: ArticleState, formData: FormData) => Promise<ArticleState>;

export type ArticleDefaults = {
  id?: string;
  title?: string;
  excerpt?: string;
  body?: string;
  bodyFormat?: string;
  categoryId?: string | null;
  visibility?: string;
};

function Field({
  label, error, children, hint,
}: {
  label: string;
  error?: string[];
  children: React.ReactNode;
  hint?: string;
}) {
  const tm = useServerMessage();
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{tm(error[0])}</p> : null}
    </div>
  );
}

export function ArticleEditor({
  action,
  categories,
  submitLabel,
  defaults = {},
  sourceTicket,
}: {
  action: Action;
  categories: { id: string; name: string }[];
  submitLabel: string;
  defaults?: ArticleDefaults;
  /** The ticket this article is written from; saving links the article to it. */
  sourceTicket?: { id: number; ref: string };
}) {
  const [state, formAction, pending] = useActionState<ArticleState, FormData>(action, undefined);
  const submit = useFormSubmit(formAction);
  const t = useT("knowledge");
  const te = useEnumT();
  const tm = useServerMessage();
  const fe = state?.fieldErrors ?? {};

  // Seed the rich editor from the existing article. Already-HTML articles pass
  // straight through; legacy markdown/plain content is rendered to editable HTML.
  const defaultHTML =
    defaults.bodyFormat === "html"
      ? defaults.body ?? ""
      : renderMarkdown(defaults.body ?? "", defaults.bodyFormat ?? "markdown");

  const visibilityOpts = te.options(ARTICLE_VISIBILITY_META);
  const categoryOpts = categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <form method="post" onSubmit={submit} className="grid gap-5">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      {sourceTicket ? <input type="hidden" name="linkTicketId" value={sourceTicket.id} /> : null}

      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {tm(state.error)}
        </p>
      ) : null}

      <Field label={t("fieldTitle")} error={fe.title}>
        <Input name="title" defaultValue={defaults.title} placeholder={t("titlePlaceholder")} required />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label={t("visibility")}
          error={fe.visibility}
          hint={t("visibilityHint")}
        >
          <ComboField name="visibility" options={visibilityOpts} defaultValue={defaults.visibility ?? "INTERNAL"} />
        </Field>
        <Field label={t("category")} error={fe.categoryId}>
          <ComboField name="categoryId" options={categoryOpts} defaultValue={defaults.categoryId ?? undefined} includeNone noneLabel={t("noCategory")} />
        </Field>
      </div>

      <Field label={t("excerpt")} error={fe.excerpt} hint={t("excerptHint")}>
        <Textarea name="excerpt" defaultValue={defaults.excerpt} placeholder={t("excerptPlaceholder")} className="min-h-16" />
      </Field>

      <div className="grid gap-1.5">
        <Label>{t("body")}</Label>
        <RichTextEditor
          name="bodyHtml"
          required
          ariaLabel={t("bodyAria")}
          defaultHTML={defaultHTML}
        />
        {fe.body ? <p className="text-xs text-destructive">{tm(fe.body[0])}</p> : null}
        {defaults.id ? null : (
          <p className="text-xs text-muted-foreground">
            {t.rich("draftHint", { b: (c) => <strong>{c}</strong> })}
            {sourceTicket ? <> {t.rich("linksToTicket", { ref: sourceTicket.ref, b: (c) => <strong>{c}</strong> })}</> : null}
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
