/**
 * Display rules for ticket ↔ ticket links. A TicketLink row is directional
 * (`ticketId` → `linkedTicketId`): the source reads the type as-is ("Blocks"),
 * the target reads its inverse ("Blocked by"). Pure so the page and tests share it.
 */

export type TicketLinkSide = "source" | "target";

const LABELS: Record<string, Record<TicketLinkSide, string>> = {
  RELATED: { source: "Related to", target: "Related to" },
  DUPLICATE: { source: "Duplicate of", target: "Has duplicate" },
  BLOCKS: { source: "Blocks", target: "Blocked by" },
  CAUSED_BY: { source: "Caused by", target: "Causes" },
};

/** Label for a link type as seen from the ticket on the given side. Unknown types fall back to the raw type. */
export function ticketLinkLabel(type: string, side: TicketLinkSide): string {
  return LABELS[type]?.[side] ?? type;
}

type LinkedTicket = { id: number; title: string; prefix: string };
type LinkRow = { id: string; type: string };

export type TicketLinkEntry = { linkId: string; ticket: LinkedTicket; label: string };

/**
 * Merge a ticket's outgoing links (it is the source) and incoming links (it is the
 * target) into one list, each entry pointing at the *other* ticket with the label
 * appropriate to this ticket's side.
 */
export function ticketLinkEntries(
  outgoing: (LinkRow & { linked: LinkedTicket })[],
  incoming: (LinkRow & { ticket: LinkedTicket })[],
): TicketLinkEntry[] {
  return [
    ...outgoing.map((l) => ({ linkId: l.id, ticket: l.linked, label: ticketLinkLabel(l.type, "source") })),
    ...incoming.map((l) => ({ linkId: l.id, ticket: l.ticket, label: ticketLinkLabel(l.type, "target") })),
  ];
}
