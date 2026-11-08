import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE_TEXT_CLASSES } from "@/lib/constants";
import { tabHref, type EntityTab } from "@/lib/entity-tabs";
import type { SearchParams } from "@/lib/query";
import { Msg } from "@/lib/i18n/client";

export { resolveTab, type EntityTab } from "@/lib/entity-tabs";

/**
 * Tab bar for detail pages. Server-friendly: every tab is a link that sets
 * `?tab=` (other search params are kept), so the page renders — and queries
 * data for — only the active tab. Rendered as navigation with `aria-current`
 * on the active link; the page renders the active tab's content below it.
 *
 *   const active = resolveTab(sp, tabs, "overview");
 *   <EntityTabs tabs={tabs} active={active} defaultTab="overview"
 *     basePath={`/changes/${id}`} searchParams={sp} label="Change sections" />
 */
export function EntityTabs<K extends string>({
  tabs,
  active,
  defaultTab,
  basePath,
  searchParams,
  label,
  className,
}: {
  tabs: readonly EntityTab<K>[];
  active: K;
  defaultTab: K;
  basePath: string;
  searchParams: SearchParams;
  /** Accessible name of the tab bar, e.g. "Ticket sections". */
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn("overflow-x-auto", className)}>
      <ul className="flex min-w-max items-center gap-1 border-b">
        {tabs
          .filter((tab) => !tab.hidden)
          .map((tab) => {
            const isActive = tab.key === active;
            return (
              <li key={tab.key}>
                <Link
                  href={tabHref(basePath, searchParams, tab.key, defaultTab)}
                  scroll={false}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "-mb-px inline-flex h-9 items-center gap-1.5 rounded-t-md border-b-2 px-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    isActive
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                  {tab.count ? (
                    <span className="rounded-full bg-muted px-1.5 py-px text-xs leading-4 text-muted-foreground tabular-nums">
                      {tab.count}
                    </span>
                  ) : null}
                  {tab.warning ? (
                    <>
                      <TriangleAlert aria-hidden className={cn("size-3.5", TONE_TEXT_CLASSES.warning)} />
                      <span className="sr-only">
                        {typeof tab.warning === "string" ? tab.warning : <Msg ns="components" k="tabs.needsAttention" />}
                      </span>
                    </>
                  ) : null}
                </Link>
              </li>
            );
          })}
      </ul>
    </nav>
  );
}
