import { buildHref, getParam, type SearchParams } from "@/lib/query";

/** URL search param that carries the active detail-page tab. */
export const TAB_PARAM = "tab";

/** One tab of a detail page rendered by `EntityTabs` (components/entity-tabs.tsx). */
export type EntityTab<K extends string = string> = {
  key: K;
  label: string;
  /** Count badge next to the label; rendered only when greater than 0. */
  count?: number;
  /** Warning marker next to the label; a string becomes its screen-reader text. */
  warning?: boolean | string;
  /** Hidden tabs are not rendered and cannot be opened via ?tab= (e.g. agent-only tabs). */
  hidden?: boolean;
};

/**
 * The tab to show for the current request: the `?tab=` value when it names a
 * visible tab, otherwise `fallback`. A hidden tab never resolves, so a URL can't
 * open a tab the viewer isn't allowed to see.
 */
export function resolveTab<K extends string>(
  searchParams: SearchParams,
  tabs: readonly EntityTab<K>[],
  fallback: K,
): K {
  const requested = getParam(searchParams, TAB_PARAM);
  return tabs.find((t) => !t.hidden && t.key === requested)?.key ?? fallback;
}

/**
 * Link target for one tab: keeps every other search param and drops `?tab=`
 * for the default tab so the canonical detail URL stays clean.
 */
export function tabHref(
  basePath: string,
  searchParams: SearchParams,
  key: string,
  defaultKey: string,
): string {
  return buildHref(basePath, searchParams, { [TAB_PARAM]: key === defaultKey ? null : key });
}
