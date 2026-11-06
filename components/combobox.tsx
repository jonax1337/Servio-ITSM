"use client";

import { useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ToneBadge } from "@/components/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { useSearchedOptions, type OptionSearch } from "@/components/use-searched-options";
import type { Tone } from "@/lib/constants";

export type ComboOption = {
  value: string;
  label: string;
  icon?: LucideIcon;
  tone?: Tone;
  /** show a small avatar with these initials (for people) */
  avatar?: string;
  hint?: string;
  /** greyed out and non-selectable (e.g. a status the workflow forbids) */
  disabled?: boolean;
  disabledReason?: string;
};

/** What a picker offers: a fixed set of options, or whatever a search finds for what was typed. */
export type OptionSource =
  | { options: ComboOption[]; search?: never }
  | { search: OptionSearch; options?: never };

function OptionInner({ o }: { o: ComboOption }) {
  const Icon = o.icon;
  // Single-line row for everything, incl. people (avatar + name) — same height as
  // a plain option. The email/hint stays for search matching but isn't shown for
  // people, so user pickers are as compact as the group/status ones.
  return (
    <span className="flex min-w-0 items-center gap-2 text-left">
      {o.avatar ? (
        <UserAvatar name={o.label} email={o.hint} size="xs" />
      ) : Icon ? (
        <Icon className="size-4 text-muted-foreground" />
      ) : null}
      <span className="truncate">{o.label}</span>
      {!o.avatar && o.hint ? (
        <span className="truncate text-xs text-muted-foreground">{o.hint}</span>
      ) : null}
    </span>
  );
}

/**
 * A searchable single select. With `search` the list is whatever the search returns for the typed
 * text (the caller decides how many), instead of a fixed `options` list.
 */
export function Combobox({
  options,
  search,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results found.",
  name,
  disabled,
  className,
  size = "default",
  pending,
}: OptionSource & {
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  size?: "default" | "sm";
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ComboOption>();
  const found = useSearchedOptions(search, open, query);
  const listed = search ? found : options;
  const selected = listed.find((o) => o.value === value) ?? (picked?.value === value ? picked : undefined);

  return (
    <>
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size={size}
              disabled={disabled}
              aria-expanded={open}
              data-pending={pending ? "" : undefined}
              className={cn(
                // h-auto + min-h keeps single-line rows compact but lets a two-line
                // person (name over email) grow the trigger.
                "h-auto min-h-8 w-full justify-between gap-2 rounded-md py-1 font-normal data-[pending]:opacity-70",
                !selected && "text-muted-foreground",
                className,
              )}
            />
          }
        >
          {selected ? (
            selected.tone ? (
              <ToneBadge
                meta={{ label: selected.label, tone: selected.tone, icon: selected.icon }}
                className="border-0 bg-transparent px-0"
              />
            ) : (
              <OptionInner o={selected} />
            )
          ) : (
            <span className="truncate">{placeholder}</span>
          )}
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--anchor-width)] min-w-56 rounded-md p-0">
          <Command shouldFilter={!search}>
            <CommandInput placeholder={searchPlaceholder} value={query} onValueChange={setQuery} />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {listed.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={search ? o.value : `${o.label} ${o.hint ?? ""}`}
                    data-checked={o.value === value}
                    disabled={o.disabled}
                    title={o.disabled ? o.disabledReason : undefined}
                    onSelect={() => {
                      if (o.disabled) return;
                      onChange(o.value);
                      setPicked(o);
                      setOpen(false);
                    }}
                  >
                    {o.tone ? (
                      <ToneBadge
                        meta={{ label: o.label, tone: o.tone, icon: o.icon }}
                        className="border-0 bg-transparent px-0"
                      />
                    ) : (
                      <OptionInner o={o} />
                    )}
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
