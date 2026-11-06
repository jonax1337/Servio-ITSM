import type { EntityTab } from "@/lib/entity-tabs";

export type AssetTabKey = "overview" | "relationships" | "work" | "contracts" | "history";

export const DEFAULT_ASSET_TAB: AssetTabKey = "overview";

export type AssetTabCounts = {
  relations: number;
  tickets: number;
  changes: number;
};

export function buildAssetTabs(counts: AssetTabCounts): EntityTab<AssetTabKey>[] {
  return [
    { key: "overview", label: "Overview" },
    { key: "relationships", label: "Relationships & impact", count: counts.relations },
    { key: "work", label: "Tickets & changes", count: counts.tickets + counts.changes },
    { key: "contracts", label: "Contracts & licenses" },
    { key: "history", label: "History" },
  ];
}
