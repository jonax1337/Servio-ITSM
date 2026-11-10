import type { EntityTab } from "@/lib/entity-tabs";

export type ServiceTabKey = "overview" | "configuration" | "catalog" | "approvals" | "history";

export const DEFAULT_SERVICE_TAB: ServiceTabKey = "overview";

export type ServiceTabCounts = {
  openTickets: number;
  /** Supporting CIs plus the services it depends on. */
  configuration: number;
  catalogItems: number;
  pendingApprovals: number;
};

export function buildServiceTabs(counts: ServiceTabCounts): EntityTab<ServiceTabKey>[] {
  return [
    { key: "overview", label: "Overview", count: counts.openTickets },
    { key: "configuration", label: "CIs & dependencies", count: counts.configuration },
    { key: "catalog", label: "Catalog", count: counts.catalogItems },
    { key: "approvals", label: "Approvals", count: counts.pendingApprovals },
    { key: "history", label: "History" },
  ];
}
