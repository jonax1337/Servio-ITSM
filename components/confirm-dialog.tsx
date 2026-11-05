"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { readActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import type { VariantProps } from "class-variance-authority";
import { buttonVariants } from "@/components/ui/button";

type BtnVariant = VariantProps<typeof buttonVariants>["variant"];
type BtnSize = VariantProps<typeof buttonVariants>["size"];

/**
 * A trigger button that opens a confirmation dialog before running a
 * (destructive) server action. Pass the action and any hidden form fields.
 * An action returning `{ ok, error }` has its refusal toasted, and its success
 * toasted when `successMessage` is given.
 */
export function ConfirmButton({
  action,
  fields = {},
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  confirmVariant = "destructive",
  triggerVariant = "destructive",
  triggerSize = "icon-sm",
  triggerClassName,
  triggerLabel,
  successMessage,
  children,
}: {
  action: (formData: FormData) => unknown | Promise<unknown>;
  fields?: Record<string, string | number>;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: BtnVariant;
  triggerVariant?: BtnVariant;
  triggerSize?: BtnSize;
  triggerClassName?: string;
  triggerLabel?: string;
  successMessage?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
    startTransition(async () => {
      // finally closes deterministically on success OR error; a redirect thrown
      // by the action (e.g. deleteArticle) still propagates after closing.
      try {
        const result = readActionResult(await action(fd));
        if (result && !result.ok) toast.error(result.error || "Action failed.");
        else if (result && successMessage) toast.success(successMessage);
      } finally {
        setOpen(false);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={triggerVariant} size={triggerSize} className={triggerClassName} aria-label={triggerLabel} />
        }
      >
        {children}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={confirmVariant} onClick={confirm} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A CONTROLLED confirmation dialog (no built-in trigger) — for confirming a
 * destructive action from a menu item or other external control, where the
 * trigger can't be the dialog's own button (e.g. inside a DropdownMenu).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  confirmVariant = "destructive",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: () => unknown | Promise<unknown>;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: BtnVariant;
}) {
  const [pending, startTransition] = useTransition();
  const confirm = () => {
    startTransition(async () => {
      try {
        await onConfirm();
      } finally {
        onOpenChange(false);
      }
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={confirmVariant} onClick={confirm} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
