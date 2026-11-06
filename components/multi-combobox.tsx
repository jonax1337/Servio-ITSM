"use client";

import { useEffect, useState } from "react";
import { ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import type { ComboOption } from "@/components/combobox";

const SEARCH_DEBOUNCE_MS = 200;

/** What the list offers: a fixed set of options, or whatever a search finds for what was typed. */
type Source =
  | { options: ComboOption[]; search?: never }
  | { search: (query: string) => Promise<ComboOption[]>; options?: never };

/**
 * A searchable multi-select for native forms: every chosen option is posted as its own hidden
 * `name` input, so the action reads them with `formData.getAll(name)`. The list opens above the
 * field so it never covers the submit button that follows a form's last field.
 *
 * Chosen options show as chips below the field, each with its own remove button; Backspace in the
 * field or its search box removes the last one. With `search` the list is whatever the search
 * returns for the typed text (the caller decides how many), instead of a fixed `options` list.
 */
export function MultiCombobox({
  name,
  options,
  search,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results found.",
}: Source & {
  name: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<ComboOption[]>([]);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<ComboOption[]>([]);

  useEffect(() => {
    if (!search || !open) return;
    let current = true;
    const timer = setTimeout(
      () => {
        search(query)
          .then((results) => current && setFound(results))
          .catch(() => current && setFound([]));
      },
      query ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [search, open, query]);

  const listed = search ? found : options;
  const isChosen = (value: string) => chosen.some((o) => o.value === value);
  const toggle = (option: ComboOption) =>
    setChosen((list) => (isChosen(option.value) ? list.filter((o) => o.value !== option.value) : [...list, option]));
  const removeLast = () => setChosen((list) => list.slice(0, -1));
  const removeLastOnBackspace = (e: React.KeyboardEvent, isEmpty: boolean) => {
    if (e.key !== "Backspace" || !isEmpty) return;
    e.preventDefault();
    removeLast();
  };

  return (
    <div className="grid gap-1.5">
      {chosen.map((o) => <input key={o.value} type="hidden" name={name} value={o.value} />)}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              aria-expanded={open}
              onKeyDown={(e) => removeLastOnBackspace(e, true)}
              className="h-8 w-full justify-between gap-2 rounded-md font-normal text-muted-foreground"
            />
          }
        >
          <span className="truncate">{placeholder}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-[var(--anchor-width)] min-w-56 rounded-md p-0">
          <Command shouldFilter={!search}>
            <CommandInput
              placeholder={searchPlaceholder}
              value={query}
              onValueChange={setQuery}
              onKeyDown={(e) => removeLastOnBackspace(e, query === "")}
            />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {listed.map((o) => (
                  <CommandItem key={o.value} value={search ? o.value : o.label} data-checked={isChosen(o.value)} onSelect={() => toggle(o)}>
                    <span className="truncate">{o.label}</span>
                    {o.hint ? <span className="ml-auto shrink-0 text-xs text-muted-foreground">{o.hint}</span> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {chosen.length > 0 ? (
        <ul className="flex flex-wrap gap-1" aria-label="Selected">
          {chosen.map((o) => (
            <li key={o.value} className="inline-flex items-center gap-1 rounded-md bg-muted py-0.5 pl-1.5 pr-0.5 text-xs">
              {o.label}
              <button
                type="button"
                aria-label={`Remove ${o.label}`}
                className="rounded-sm p-0.5 hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => toggle(o)}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
