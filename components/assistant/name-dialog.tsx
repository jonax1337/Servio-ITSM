"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/client";

/**
 * A small controlled dialog with a single text field, used across the Sable
 * project / folder UI for both create and rename. Validates a trimmed non-empty
 * name and runs an async `onSubmit`, closing on success. Seed `initialValue` for
 * rename; leave empty for create.
 */
export function NameDialog({
  open,
  onOpenChange,
  title,
  label,
  placeholder,
  initialValue = "",
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  onSubmit: (name: string) => Promise<void> | void;
}) {
  const tc = useT("common");
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);

  // Re-seed the field whenever the dialog re-opens (or is opened for a different
  // subject) — adjust state during render rather than in an effect.
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = open ? initialValue : null;
  if (open && key !== lastKey) {
    setLastKey(key);
    setValue(initialValue);
  } else if (!open && lastKey !== null) {
    setLastKey(null);
  }

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          className="grid gap-4"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="name-dialog-input">{label ?? tc("name")}</Label>
            <Input
              id="name-dialog-input"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={placeholder}
              disabled={busy}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              {tc("cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {submitLabel ?? tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
