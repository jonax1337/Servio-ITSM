"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/combobox";
import { CHANGE_STATUS_META, CHANGE_STATUSES, RISK_META, RISKS } from "@/lib/constants";

const FILTER_KEYS = ["team", "risk", "status"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

/** Team / risk / status filters of the change calendar, kept in the URL so views are shareable. */
export function CalendarFilters({ teams }: { teams: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const navigate = (params: URLSearchParams) =>
    startTransition(() => router.push(params.size > 0 ? `${pathname}?${params.toString()}` : pathname));

  const setFilter = (key: FilterKey, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === "all") params.delete(key);
    else params.set(key, value);
    navigate(params);
  };

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    FILTER_KEYS.forEach((key) => params.delete(key));
    navigate(params);
  };

  const filters: { key: FilterKey; label: string; allLabel: string; options: ComboOption[] }[] = [
    { key: "team", label: "Team", allLabel: "All teams", options: teams.map((t) => ({ value: t.id, label: t.name })) },
    { key: "risk", label: "Risk", allLabel: "All risks", options: RISKS.map((r) => ({ value: r, label: RISK_META[r].label })) },
    { key: "status", label: "Status", allLabel: "All statuses", options: CHANGE_STATUSES.map((s) => ({ value: s, label: CHANGE_STATUS_META[s].label })) },
  ];
  const hasFilters = FILTER_KEYS.some((key) => searchParams.get(key));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((filter) => (
        <Combobox
          key={filter.key}
          options={[{ value: "all", label: filter.allLabel }, ...filter.options]}
          value={searchParams.get(filter.key) ?? "all"}
          onChange={(value) => setFilter(filter.key, value || "all")}
          placeholder={filter.label}
          searchPlaceholder={`Search ${filter.label.toLowerCase()}…`}
          size="sm"
          className="w-auto min-w-[9rem]"
        />
      ))}
      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          <X className="size-4" /> Clear
        </Button>
      ) : null}
    </div>
  );
}
