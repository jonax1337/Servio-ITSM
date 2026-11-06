"use client";

import { useState } from "react";
import { ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import type { ComboOption } from "@/components/combobox";

/**
 * A searchable multi-select for native forms: every chosen option is posted as its own hidden
 * `name` input, so the action reads them with `formData.getAll(name)`. The list opens above the
 * field so it never covers the submit button that follows a form's last field.
 */
export function MultiCombobox({
  name,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results found.",
}: {
  name: string;
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const chosen = options.filter((o) => selected.includes(o.value));
  const toggle = (value: string) =>
    setSelected((s) => (s.includes(value) ? s.filter((v) => v !== value) : [...s, value]));

  return (
    <>
      {selected.map((value) => <input key={value} type="hidden" name={name} value={value} />)}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              aria-expanded={open}
              className={cn(
                "h-auto min-h-8 w-full justify-between gap-2 rounded-md py-1 font-normal",
                chosen.length === 0 && "text-muted-foreground",
              )}
            />
          }
        >
          {chosen.length === 0 ? (
            <span className="truncate">{placeholder}</span>
          ) : (
            <span className="flex min-w-0 flex-wrap gap-1">
              {chosen.map((o) => (
                <span key={o.value} className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs">
                  {o.label}
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={`Remove ${o.label}`}
                    className="rounded-sm hover:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(o.value);
                    }}
                  >
                    <X className="size-3" />
                  </span>
                </span>
              ))}
            </span>
          )}
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-[var(--anchor-width)] min-w-56 rounded-md p-0">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem key={o.value} value={o.label} data-checked={selected.includes(o.value)} onSelect={() => toggle(o.value)}>
                    <span className="truncate">{o.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
