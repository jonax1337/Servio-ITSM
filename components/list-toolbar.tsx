"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Combobox, type ComboOption } from "@/components/combobox";
import { Button } from "@/components/ui/button";

export type FilterDef = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
};

/** A filter's name inside a sentence ("All priorities"): lower case, except an acronym like SLA. */
const asNoun = (label: string) => (label === label.toUpperCase() ? label : label.toLowerCase());

export function ListToolbar({
  filters = [],
  searchPlaceholder = "Search…",
  children,
}: {
  filters?: FilterDef[];
  searchPlaceholder?: string;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [q, setQ] = useState(sp.get("q") ?? "");

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(sp.toString());
      if (!value || value === "all") params.delete(key);
      else params.set(key, value);
      params.delete("page");
      startTransition(() => router.push(`${pathname}?${params.toString()}`));
    },
    [sp, pathname, router],
  );

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) setParam("q", q);
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters =
    q || filters.some((f) => sp.get(f.key));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={searchPlaceholder}
          className="pl-8"
        />
        {isPending ? (
          <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : null}
      </div>

      {filters.map((f) => {
        const opts: ComboOption[] = [
          { value: "all", label: `All ${asNoun(f.label)}` },
          ...f.options,
        ];
        return (
          <Combobox
            key={f.key}
            options={opts}
            value={sp.get(f.key) ?? "all"}
            onChange={(v) => setParam(f.key, v || "all")}
            placeholder={f.label}
            searchPlaceholder={`Search ${asNoun(f.label)}…`}
            size="sm"
            className="w-auto min-w-[9rem]"
          />
        );
      })}

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            startTransition(() => router.push(pathname));
          }}
        >
          <X className="size-4" /> Clear
        </Button>
      ) : null}

      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}
