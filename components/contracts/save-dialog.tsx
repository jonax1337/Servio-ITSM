"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import type { SaveResult } from "@/lib/actions/contracts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useServerMessage, useT } from "@/lib/i18n/client";

/** A labelled form row with optional helper text; `htmlFor` ties the label to a text control by id. */
export function Field({
  label,
  hint,
  htmlFor,
  required,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span aria-hidden className="text-muted-foreground"> *</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Create / edit dialog shell shared by the vendor, contract and license forms:
 * submits the form to a server action, shows a refusal inline (keeping what was
 * typed) and, on success, closes, toasts and optionally opens the new record.
 */
export function SaveDialog({
  title,
  description,
  triggerLabel,
  triggerIcon: TriggerIcon,
  triggerVariant = "default",
  triggerSize = "default",
  submitLabel,
  action,
  openCreated,
  successMessage,
  wide = false,
  children,
}: {
  title: string;
  description?: string;
  triggerLabel: string;
  triggerIcon: LucideIcon;
  triggerVariant?: "default" | "outline";
  triggerSize?: "default" | "sm";
  submitLabel: string;
  action: (formData: FormData) => Promise<SaveResult>;
  /** Href of a freshly created record; when set the dialog navigates there on success. */
  openCreated?: (id: string) => string;
  successMessage: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useT("contracts");
  const tm = useServerMessage();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await action(formData);
      if (!result.ok) {
        setError(result.error ? tm(result.error) : t("couldNotSave"));
        return;
      }
      setError(null);
      setOpen(false);
      toast.success(successMessage);
      if (openCreated && result.id) router.push(openCreated(result.id));
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setError(null); }}>
      <DialogTrigger render={<Button variant={triggerVariant} size={triggerSize} />}>
        <TriggerIcon className="size-4" /> {triggerLabel}
      </DialogTrigger>
      <DialogContent className={wide ? "max-h-[88vh] overflow-y-auto sm:max-w-2xl" : "max-h-[88vh] overflow-y-auto sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          {error ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {children}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
