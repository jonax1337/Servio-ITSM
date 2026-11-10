"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { readActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Combobox, type ComboOption, type OptionSource } from "@/components/combobox";
import type { OptionSearch } from "@/components/use-searched-options";
import { useServerMessage, useT } from "@/lib/i18n/client";

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
  options = [],
  search,
  placeholder,
  searchPlaceholder,
  emptyText,
  submitLabel,
  typeName,
  typeOptions,
  typeDefault,
  noteName,
  notePlaceholder,
  successMessage,
}: {
  action: (formData: FormData) => unknown | Promise<unknown>;
  triggerLabel: string;
  title: string;
  description?: string;
  hidden: Record<string, string | number>;
  valueName: string;
  /** A fixed list of targets, or `search` to look them up as the user types (for sets too big to preload). */
  options?: ComboOption[];
  search?: OptionSearch;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  submitLabel?: string;
  /** Optional relation-type selector (e.g. asset "Depends on"). */
  typeName?: string;
  typeOptions?: ComboOption[];
  typeDefault?: string;
  /** Optional free-text field posted with the link (e.g. the note on a service dependency). */
  noteName?: string;
  notePlaceholder?: string;
  successMessage?: string;
}) {
  const t = useT("components");
  const tm = useServerMessage();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [type, setType] = useState(typeDefault ?? typeOptions?.[0]?.value ?? "");
  const source: OptionSource = search ? { search } : { options };
  const noOptions = !search && options.length === 0;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
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
              {emptyText ?? t("link.nothingToLink")}
            </p>
          ) : (
            <form
              action={async (fd) => {
                const result = readActionResult(await action(fd));
                if (result && !result.ok) {
                  toast.error(result.error ? tm(result.error) : t("link.failed"));
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
                  placeholder={t("link.relationship")}
                  searchPlaceholder={t("link.searchTypes")}
                />
              ) : null}
              <Combobox
                name={valueName}
                {...source}
                value={target}
                onChange={setTarget}
                placeholder={placeholder ?? t("link.choose")}
                searchPlaceholder={searchPlaceholder ?? t("combo.search")}
              />
              {noteName ? <Input name={noteName} placeholder={notePlaceholder} maxLength={500} /> : null}
              <DialogFooter>
                <Button type="submit" disabled={!target}>{submitLabel ?? t("link.submit")}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
