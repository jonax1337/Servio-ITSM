import { OverviewTab } from "@/components/changes/tabs/overview-tab";
import { PlanningTab } from "@/components/changes/tabs/planning-tab";
import { CabTab } from "@/components/changes/tabs/cab-tab";
import { ImpactTab } from "@/components/changes/tabs/impact-tab";
import { LinksTab } from "@/components/changes/tabs/links-tab";
import { DiscussionTab } from "@/components/changes/tabs/discussion-tab";
import { HistoryTab } from "@/components/changes/tabs/history-tab";
import type { ChangeTabKey } from "@/components/changes/tabs/change-tabs";
import type { ChangeTabContext } from "@/components/changes/tabs/types";

/** Renders the one active tab, so only its data is loaded. */
export function ChangeTabPanel({ tab, ...context }: ChangeTabContext & { tab: ChangeTabKey }) {
  switch (tab) {
    case "overview": return <OverviewTab {...context} />;
    case "planning": return <PlanningTab {...context} />;
    case "cab": return <CabTab {...context} />;
    case "impact": return <ImpactTab {...context} />;
    case "links": return <LinksTab {...context} />;
    case "discussion": return <DiscussionTab {...context} />;
    case "history": return <HistoryTab {...context} />;
  }
}
