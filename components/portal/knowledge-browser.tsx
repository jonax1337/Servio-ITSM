"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Eye, ArrowUpRight, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { PortalSearchField } from "@/components/portal/portal-search-field";
import { useT } from "@/lib/i18n/client";

const ALL = "__all__";

export type KbCard = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  category: string;
  views: number;
};

/**
 * Knowledge-base browser — deliberately mirrors CatalogBrowser exactly (search
 * field, category pills, card grid) so the two portal pages are identical.
 */
export function KnowledgeBrowser({
  items,
  initialQuery = "",
}: {
  items: KbCard[];
  initialQuery?: string;
}) {
  const categories = useMemo(
    () => Array.from(new Set(items.map((i) => i.category))),
    [items],
  );
  const t = useT("portal");
  // ALL is a sentinel (not a category name), so a category literally named "All" still works.
  const [active, setActive] = useState<string>(ALL);
  const [query, setQuery] = useState(initialQuery);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      const inCat = active === ALL || i.category === active;
      const inQuery =
        !q ||
        i.title.toLowerCase().includes(q) ||
        i.excerpt.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q);
      return inCat && inQuery;
    });
  }, [items, active, query]);

  const countFor = (label: string) =>
    label === ALL ? items.length : items.filter((i) => i.category === label).length;

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
      {label === ALL ? <LayoutGrid className="size-3.5" /> : null}
      {label === ALL ? t("allCategories") : label}
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
        placeholder={t("searchArticles")}
      />

      {/* Category navigation */}
      <div role="group" aria-label={t("filterByCategory")} className="-mx-1 flex flex-wrap gap-2 px-1">
        {chip(ALL)}
        {categories.map((c) => chip(c))}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/40 py-16 text-center text-sm text-muted-foreground">
          {t("noArticlesMatch")}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {shown.map((a) => (
            <Link
              key={a.id}
              href={`/portal/knowledge/${a.slug}`}
              className="group flex flex-col rounded-2xl border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-muted/20"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-medium text-primary">{a.category}</span>
                <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <h2 className="mt-2 font-display text-base font-semibold tracking-tight">{a.title}</h2>
              <p className="mt-1 line-clamp-2 flex-1 text-sm text-muted-foreground">{a.excerpt}</p>
              <div className="mt-4 flex items-center gap-1 text-xs text-muted-foreground">
                <Eye className="size-3.5" /> {t("viewCount", { count: a.views })}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
