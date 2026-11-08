"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useLocale, useT } from "@/lib/i18n/client";

/** Escape plaintext + convert newlines to <br> so an existing plaintext description
 *  seeds the rich editor without losing line breaks. */
function seedHtml(html: string | null | undefined, text: string): string {
  if (html) return html;
  const esc = (text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc.replace(/\n/g, "<br>");
}

function SaveButton() {
  const { pending } = useFormStatus();
  const t = useT("common");
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      {t("saveChanges")}
    </Button>
  );
}

export function EditEntityDialog({
  action,
  idField,
  id,
  title,
  description,
  descriptionHtml,
  entityLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  idField: string;
  id: number | string;
  title: string;
  description: string;
  descriptionHtml?: string | null;
  entityLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const t = useT("components");
  const tc = useT("common");
  const locale = useLocale();
  const entity = entityLabel ?? t("edit.record");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil className="size-4" /> {tc("edit")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("edit.title", { entity: locale === "en" ? entity : entity.charAt(0).toUpperCase() + entity.slice(1) })}</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => { await action(fd); setOpen(false); }}
          className="grid gap-4"
        >
          <input type="hidden" name={idField} value={id} />
          <div className="grid gap-1.5">
            <Label htmlFor="edit-title">{tc("title")}</Label>
            <Input id="edit-title" name="title" defaultValue={title} required />
          </div>
          <div className="grid gap-1.5">
            <Label>{tc("description")}</Label>
            <RichTextEditor name="descriptionHtml" ariaLabel={tc("description")} defaultHTML={seedHtml(descriptionHtml, description)} />
          </div>
          <DialogFooter>
            <SaveButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
