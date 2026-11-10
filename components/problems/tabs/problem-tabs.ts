import type { EntityTab } from "@/lib/entity-tabs";

export type ProblemTabKey = "overview" | "incidents" | "changes" | "impact" | "discussion" | "history";

export const DEFAULT_PROBLEM_TAB: ProblemTabKey = "overview";

export type ProblemTabCounts = {
  incidents: number;
  changes: number;
  /** CIs the problem is known to affect. */
  affectedCis: number;
  comments: number;
};

/** The affected-CI tab is agent-only, like the CI pickers and service impact it shows. */
export function buildProblemTabs(counts: ProblemTabCounts, isAgentUser: boolean): EntityTab<ProblemTabKey>[] {
  return [
    { key: "overview", label: "Overview" },
    { key: "incidents", label: "Incidents", count: counts.incidents },
    { key: "changes", label: "Fix changes", count: counts.changes },
    { key: "impact", label: "Affected CIs", count: counts.affectedCis, hidden: !isAgentUser },
    { key: "discussion", label: "Discussion & approvals", count: counts.comments },
    { key: "history", label: "History" },
  ];
}
