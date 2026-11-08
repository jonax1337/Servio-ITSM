"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/combobox";
import { CHANGE_STATUS_META, CHANGE_STATUSES, RISK_META, RISKS } from "@/lib/constants";
import { useEnumT, useT } from "@/lib/i18n/client";

const FILTER_KEYS = ["team", "risk", "status"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

/** Team / risk / status filters of the change calendar, kept in the URL so views are shareable. */
export function CalendarFilters({ teams }: { teams: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const t = useT("changes");
  const tc = useT("common");
  const te = useEnumT();

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
    { key: "team", label: t("calendar.team"), allLabel: t("calendar.allTeams"), options: teams.map((team) => ({ value: team.id, label: team.name })) },
    { key: "risk", label: tc("risk"), allLabel: t("calendar.allRisks"), options: te.options(RISK_META, RISKS) },
    { key: "status", label: tc("status"), allLabel: t("calendar.allStatuses"), options: te.options(CHANGE_STATUS_META, CHANGE_STATUSES) },
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
          searchPlaceholder={t("props.searchField", { field: filter.label.toLowerCase() })}
          size="sm"
          className="w-auto min-w-[9rem]"
        />
      ))}
      {hasFilters ? (
        <Button variant="ghost" size="sm" onClick={clearFilters}>
          <X className="size-4" /> {tc("clear")}
        </Button>
      ) : null}
    </div>
  );
}
