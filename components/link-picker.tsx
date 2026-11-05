"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { readActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Combobox, type ComboOption } from "@/components/combobox";

/**
 * Generic "add a link" control: a small trigger button that opens a dialog with a
 * target Combobox (and an optional relation-type Combobox), then submits a Server
 * Action with a set of fixed hidden fields plus the chosen value(s).
 *
 * Reused across ticket ↔ problem/change/asset linking and the CMDB asset graph.
 * An action that returns `{ ok, error }` gets its refusal toasted (the dialog stays
 * open so the choice isn't lost) and, with `successMessage`, its success toasted.
 */
export function LinkPicker({
  action,
  triggerLabel,
  title,
  description,
  hidden,
  valueName,
  options,
  placeholder = "Choose…",
  searchPlaceholder = "Search…",
  emptyText,
  submitLabel = "Link",
  typeName,
  typeOptions,
  typeDefault,
  successMessage,
}: {
  action: (formData: FormData) => unknown | Promise<unknown>;
  triggerLabel: string;
  title: string;
  description?: string;
  hidden: Record<string, string | number>;
  valueName: string;
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  submitLabel?: string;
  /** Optional relation-type selector (e.g. asset "Depends on"). */
  typeName?: string;
  typeOptions?: ComboOption[];
  typeDefault?: string;
  successMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [type, setType] = useState(typeDefault ?? typeOptions?.[0]?.value ?? "");
  const noOptions = options.length === 0;

  return (
    <>
      <Button type="button" variant="outline" size="xs" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {noOptions ? (
            <p className="rounded-lg border bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
              {emptyText ?? "Nothing available to link."}
            </p>
          ) : (
            <form
              action={async (fd) => {
                const result = readActionResult(await action(fd));
                if (result && !result.ok) {
                  toast.error(result.error || "Could not link record.");
                  return;
                }
                if (result && successMessage) toast.success(successMessage);
                setOpen(false);
                setTarget("");
              }}
              className="grid gap-3"
            >
              {Object.entries(hidden).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              {typeName && typeOptions ? (
                <Combobox
                  name={typeName}
                  options={typeOptions}
                  value={type}
                  onChange={(v) => setType(v || (typeDefault ?? ""))}
                  placeholder="Relationship"
                  searchPlaceholder="Search types…"
                />
              ) : null}
              <Combobox
                name={valueName}
                options={options}
                value={target}
                onChange={setTarget}
                placeholder={placeholder}
                searchPlaceholder={searchPlaceholder}
              />
              <DialogFooter>
                <Button type="submit" disabled={!target}>{submitLabel}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
