"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck, Clock, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { CatalogIcon } from "@/components/catalog/catalog-icon";
import { PortalSearchField } from "@/components/portal/portal-search-field";
import { useT } from "@/lib/i18n/client";

export type CatalogCard = {
  id: string;
  name: string;
  short: string;
  icon: string | null;
  category: string;
  estimatedDays: number | null;
  requiresApproval: boolean;
};

export function CatalogBrowser({ items }: { items: CatalogCard[] }) {
  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category))),
    [items],
  );
  const t = useT("catalog");
  const [active, setActive] = useState<string>("All");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      const inCat = active === "All" || i.category === active;
      const inQuery =
        !q ||
        i.name.toLowerCase().includes(q) ||
        i.short.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q);
      return inCat && inQuery;
    });
  }, [items, active, query]);

  const countFor = (label: string) =>
    label === "All" ? items.length : items.filter((i) => i.category === label).length;

  const chip = (label: string) => (
    <button
      key={label}
      type="button"
      aria-pressed={active === label}
      onClick={() => setActive(label)}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active === label
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      {label === "All" ? <LayoutGrid className="size-3.5" /> : null}
      {label === "All" ? t("all") : label}
      <span
        className={cn(
          "rounded-full px-1.5 text-xs tabular-nums",
          active === label ? "bg-primary-foreground/20" : "bg-muted",
        )}
      >
        {countFor(label)}
      </span>
    </button>
  );

  return (
    <div className="grid gap-6">
      {/* Search */}
      <PortalSearchField
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("searchCatalog")}
      />

      {/* Category navigation */}
      <div role="group" aria-label={t("filterByCategory")} className="-mx-1 flex flex-wrap gap-2 px-1">
        {chip("All")}
        {categories.map((c) => chip(c))}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/40 py-16 text-center text-sm text-muted-foreground">
          {t("noMatches")}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((it) => (
            <Link
              key={it.id}
              href={`/portal/request/${it.id}`}
              className="group flex flex-col rounded-2xl border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-muted/20"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                  <CatalogIcon name={it.icon} className="size-5" />
                </span>
                {it.requiresApproval ? (
                  <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    <ShieldCheck className="size-3" /> {t("approvalBadge")}
                  </span>
                ) : null}
              </div>

              <h3 className="mt-4 font-display text-base font-semibold tracking-tight">{it.name}</h3>
              <p className="mt-1 line-clamp-2 flex-1 text-sm text-muted-foreground">{it.short}</p>

              <div className="mt-4 flex items-center gap-3 border-t pt-3 text-xs text-muted-foreground">
                <span className="truncate">{it.category}</span>
                {it.estimatedDays != null ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <Clock className="size-3.5" /> {t("estimatedDays", { count: it.estimatedDays })}
                  </span>
                ) : null}
                <span className="ml-auto flex shrink-0 items-center gap-1 font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  {t("request")} <ArrowRight className="size-3.5" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
