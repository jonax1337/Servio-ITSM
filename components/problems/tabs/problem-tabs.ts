import type { EntityTab } from "@/lib/entity-tabs";

export type ProblemTabKey = "overview" | "incidents" | "changes" | "discussion" | "history";

export const DEFAULT_PROBLEM_TAB: ProblemTabKey = "overview";

export type ProblemTabCounts = {
  incidents: number;
  changes: number;
  comments: number;
};

export function buildProblemTabs(counts: ProblemTabCounts): EntityTab<ProblemTabKey>[] {
  return [
    { key: "overview", label: "Overview" },
    { key: "incidents", label: "Incidents", count: counts.incidents },
    { key: "changes", label: "Fix changes", count: counts.changes },
    { key: "discussion", label: "Discussion & approvals", count: counts.comments },
    { key: "history", label: "History" },
  ];
}
