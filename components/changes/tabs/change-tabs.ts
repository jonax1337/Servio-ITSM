import type { EntityTab } from "@/lib/entity-tabs";

export const CHANGE_TAB_KEYS = ["overview", "planning", "cab", "impact", "links", "discussion", "history"] as const;
export type ChangeTabKey = (typeof CHANGE_TAB_KEYS)[number];

export const DEFAULT_CHANGE_TAB: ChangeTabKey = "overview";

const TAB_LABELS: Record<ChangeTabKey, string> = {
  overview: "Overview",
  planning: "Planning",
  cab: "CAB & approvals",
  impact: "Impact",
  links: "Links",
  discussion: "Discussion",
  history: "History",
};

export type ChangeTabCounts = {
  /** CAB seats that have not decided yet. */
  pendingApprovals: number;
  affectedCis: number;
  /** Everything the Links tab lists (see changeLinkCount). */
  links: number;
  comments: number;
};

/** Linked problem, tickets and affected CIs, so the Links badge matches what the tab shows. */
export function changeLinkCount(l: { hasProblem: boolean; tickets: number; assets: number }): number {
  return Number(l.hasProblem) + l.tickets + l.assets;
}

/**
 * Tabs of the change detail page. Planning is flagged while a draft still lacks what
 * submitting needs; the other tabs carry count badges like the ticket page does.
 */
export function buildChangeTabs({
  status,
  submitBlockers,
  counts,
}: {
  status: string;
  submitBlockers: readonly string[];
  counts: ChangeTabCounts;
}): EntityTab<ChangeTabKey>[] {
  const planningWarning = status === "DRAFT" && submitBlockers.length > 0 ? `Missing: ${submitBlockers.join(", ")}` : undefined;
  const countByTab: Partial<Record<ChangeTabKey, number>> = {
    cab: counts.pendingApprovals,
    impact: counts.affectedCis,
    links: counts.links,
    discussion: counts.comments,
  };
  return CHANGE_TAB_KEYS.map((key) => ({
    key,
    label: TAB_LABELS[key],
    ...(key === "planning" && planningWarning ? { warning: planningWarning } : {}),
    count: countByTab[key],
  }));
}
