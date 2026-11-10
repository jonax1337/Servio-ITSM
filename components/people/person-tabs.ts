import type { EntityTab } from "@/lib/entity-tabs";

export type PersonTabKey = "tickets" | "assets" | "groups";

export const DEFAULT_PERSON_TAB: PersonTabKey = "tickets";

export type PersonTabCounts = {
  openTickets: number;
  assets: number;
  groups: number;
};

export function buildPersonTabs(counts: PersonTabCounts): EntityTab<PersonTabKey>[] {
  return [
    { key: "tickets", label: "Open tickets", count: counts.openTickets },
    { key: "assets", label: "Assets", count: counts.assets },
    { key: "groups", label: "Groups", count: counts.groups },
  ];
}
