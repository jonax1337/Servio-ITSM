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
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-destructive">{error[0]}</p> : null}
    </div>
  );
}

export function ArticleEditor({
  action,
  categories,
  submitLabel,
  defaults = {},
}: {
  action: Action;
  categories: { id: string; name: string }[];
  submitLabel: string;
  defaults?: ArticleDefaults;
}) {
  const [state, formAction, pending] = useActionState<ArticleState, FormData>(action, undefined);
  const submit = useFormSubmit(formAction);
  const fe = state?.fieldErrors ?? {};

  // Seed the rich editor from the existing article. Already-HTML articles pass
  // straight through; legacy markdown/plain content is rendered to editable HTML.
  const defaultHTML =
    defaults.bodyFormat === "html"
      ? defaults.body ?? ""
      : renderMarkdown(defaults.body ?? "", defaults.bodyFormat ?? "markdown");

  const visibilityOpts = Object.entries(ARTICLE_VISIBILITY_META).map(([value, m]) => ({
    value,
    label: m.label,
  }));
  const categoryOpts = categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <form onSubmit={submit} className="grid gap-5">
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}

      {state?.error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Field label="Title" error={fe.title}>
        <Input name="title" defaultValue={defaults.title} placeholder="e.g. How to connect to the VPN" required />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Visibility"
          error={fe.visibility}
          hint="Public articles appear in the end-user portal. Internal stays agent-only."
        >
          <ComboField name="visibility" options={visibilityOpts} defaultValue={defaults.visibility ?? "INTERNAL"} />
        </Field>
        <Field label="Category" error={fe.categoryId}>
          <ComboField name="categoryId" options={categoryOpts} defaultValue={defaults.categoryId ?? undefined} includeNone noneLabel="— No category —" />
        </Field>
      </div>

      <Field label="Excerpt" error={fe.excerpt} hint="A one-line summary shown in lists and search results.">
        <Textarea name="excerpt" defaultValue={defaults.excerpt} placeholder="Short summary…" className="min-h-16" />
      </Field>

      <div className="grid gap-1.5">
        <Label>Body</Label>
        <RichTextEditor
          name="bodyHtml"
          required
          ariaLabel="Article body"
          defaultHTML={defaultHTML}
        />
        {fe.body ? <p className="text-xs text-destructive">{fe.body[0]}</p> : null}
        <p className="text-xs text-muted-foreground">
          New articles start as a <strong>Draft</strong> — publish from the article page once ready.
        </p>
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
