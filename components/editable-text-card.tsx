"use client";

import { useState, useTransition } from "react";
import { Pencil, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useLocale, useT } from "@/lib/i18n/client";

/**
 * A titled card whose free-text body (e.g. a problem's root cause, a change's
 * rollback plan) can be edited in-place behind a dialog. The server action
 * receives { [idField]: id, field, value }. Read-only when `editable` is false.
 */
export function EditableTextCard({
  action,
  idField,
  id,
  field,
  label,
  icon,
  value,
  emptyText,
  editable = true,
}: {
  action: (formData: FormData) => void | Promise<void>;
  idField: string;
  id: number | string;
  field: string;
  label: string;
  // A rendered element, not a component type — a Server Component can't pass a
  // Lucide component across the RSC boundary, but a rendered node is fine.
  icon?: React.ReactNode;
  value: string | null;
  emptyText: string;
  editable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const t = useT("components");
  const tc = useT("common");
  const locale = useLocale();
  // English lowers the label mid-sentence ("Edit root cause"); German keeps its capitals.
  const editLabel = t("edit.title", { entity: locale === "en" ? label.toLowerCase() : label });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon}
          {label}
        </CardTitle>
        {editable ? (
          <CardAction>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={editLabel}
              title={editLabel}
              onClick={() => setOpen(true)}
            >
              <Pencil className="size-3.5" />
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="text-sm leading-relaxed whitespace-pre-wrap">
        {value || <span className="text-muted-foreground">{emptyText}</span>}
      </CardContent>

      {editable ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editLabel}</DialogTitle>
            </DialogHeader>
            <form
              action={(fd) => start(async () => { await action(fd); setOpen(false); })}
              className="grid gap-4"
            >
              <input type="hidden" name={idField} value={id} />
              <input type="hidden" name="field" value={field} />
              <Textarea
                name="value"
                defaultValue={value ?? ""}
                placeholder={emptyText}
                className="min-h-44"
              />
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  {tc("cancel")}
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  {tc("save")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}
