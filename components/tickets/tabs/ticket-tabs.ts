import type { EntityTab } from "@/lib/entity-tabs";

export const TICKET_TAB_KEYS = ["conversation", "details", "links", "work", "approvals", "history"] as const;
export type TicketTabKey = (typeof TICKET_TAB_KEYS)[number];
export const DEFAULT_TICKET_TAB: TicketTabKey = "conversation";

export type TicketTabCounts = {
  comments: number;
  /** Linked problem, change, tickets, assets and hierarchy neighbours. */
  links: number;
  openTasks: number;
  pendingApprovals: number;
  /** Attachments and participants, the countable content of the Details tab. */
  details: number;
};

type LinkCountInput = {
  hasProblem: boolean;
  hasChange: boolean;
  hasParent: boolean;
  childTickets: number;
  linkedTickets: number;
  assets: number;
};

/** Everything the Links tab lists, so its badge matches what the tab shows. */
export function ticketLinkCount(l: LinkCountInput): number {
  return Number(l.hasProblem) + Number(l.hasChange) + Number(l.hasParent) + l.childTickets + l.linkedTickets + l.assets;
}

const TAB_LABELS: Record<TicketTabKey, string> = {
  conversation: "Conversation",
  details: "Details",
  links: "Links",
  work: "Work",
  approvals: "Approvals",
  history: "History",
};

/**
 * Tabs of the ticket detail page; Work and Approvals are agent-only and never resolvable for others.
 * `label` translates a tab key (the page passes the viewer's translator); English otherwise.
 */
export function ticketTabs(
  counts: TicketTabCounts,
  isAgentUser: boolean,
  label: (key: TicketTabKey) => string = (key) => TAB_LABELS[key],
): EntityTab<TicketTabKey>[] {
  return [
    { key: "conversation", label: label("conversation"), count: counts.comments },
    { key: "details", label: label("details"), count: counts.details },
    { key: "links", label: label("links"), count: counts.links },
    { key: "work", label: label("work"), count: counts.openTasks, hidden: !isAgentUser },
    { key: "approvals", label: label("approvals"), count: counts.pendingApprovals, hidden: !isAgentUser },
    { key: "history", label: label("history") },
  ];
}

/** The signed-in viewer as the tab panels need to know them. */
export type TicketViewer = {
  id: string | undefined;
  isAgent: boolean;
  isAdmin: boolean;
  canManage: boolean;
};
