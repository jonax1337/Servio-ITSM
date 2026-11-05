import { ticketRef } from "@/lib/constants";

/**
 * Parent/child and merge facts about a ticket, in the wording Sable shows on
 * approval cards and returns from its read tools. Pure, so the tests pin them.
 */

/** Prisma select for a ticket shown as a parent, child or merge target. */
const RELATED_TICKET_SELECT = { id: true, type: true, prefix: true, title: true, status: true } as const;

/** Prisma select/include fragment that loads everything {@link ticketRelations} reads. */
export const TICKET_RELATIONS_SELECT = {
  parent: { select: RELATED_TICKET_SELECT },
  children: { select: RELATED_TICKET_SELECT, orderBy: { id: "asc" }, take: 10 },
  mergedInto: { select: RELATED_TICKET_SELECT },
  _count: { select: { children: true, mergedTickets: true } },
} as const;

type TicketIdentity = { id: number; type: string; prefix?: string | null };
type RelatedTicket = TicketIdentity & { title: string; status: string };

/** Display ref keyed by the stored prefix, which stays stable when the type is switched. */
export const refFor = (t: TicketIdentity) => ticketRef(t.id, t.prefix || t.type);

export const NO_PARENT_TARGET = "none";

/** True when a model-supplied target asks to clear the parent. */
export const isNoParent = (target: string | undefined) => target?.trim().toLowerCase() === NO_PARENT_TARGET;

export function setParentLabel(ref: unknown, target: unknown): string {
  return isNoParent(String(target ?? ""))
    ? `Detach ${ref} from its parent ticket`
    : `Make ${ref} a child of ${target}`;
}

/** Spells out what the merge copies and moves, because the approval card is the only preview the user gets. */
export function mergeLabel(ref: unknown, target: unknown): string {
  return (
    `Merge ${ref} into ${target}: its comments, watchers, linked assets and ticket links are copied to ${target}, ` +
    `its attachments and child tickets are moved there, ${target} adopts its problem/change if it has none, ` +
    `its pending approvals are withdrawn, and ${ref} is cancelled. It can be undone from ${ref} afterwards`
  );
}

export const unmergeLabel = (ref: unknown) => `Undo the merge of ${ref}: restore it and take back what the merge moved`;

const summarise = (t: RelatedTicket) => ({ ref: refFor(t), title: t.title, status: t.status });

export type TicketRelationsRow = {
  parent: RelatedTicket | null;
  children: RelatedTicket[];
  mergedInto: RelatedTicket | null;
  _count: { children: number; mergedTickets: number };
};

/** Parent, children and merge facts for the ticket read tool. */
export function ticketRelations(t: TicketRelationsRow) {
  return {
    parent: t.parent ? summarise(t.parent) : null,
    childCount: t._count.children,
    children: t.children.map(summarise),
    mergedInto: t.mergedInto ? summarise(t.mergedInto) : null,
    mergedTicketCount: t._count.mergedTickets,
  };
}

const describeRelated = (t: { ref: string; title: string; status: string }) => `${t.ref} "${t.title}" (${t.status})`;

/** The same facts as prose lines for the ticket-scoped context the model reads on a ticket page. */
export function relationLines(t: TicketRelationsRow): string[] {
  const r = ticketRelations(t);
  const lines: string[] = [];
  if (r.parent) lines.push(`Parent ticket: ${describeRelated(r.parent)}`);
  if (r.childCount > 0) {
    const unlisted = r.childCount - r.children.length;
    lines.push(
      `Sub-tickets (${r.childCount}): ${r.children.map(describeRelated).join("; ")}${unlisted > 0 ? `; and ${unlisted} more` : ""}`,
    );
  }
  if (r.mergedInto) {
    lines.push(
      `Merged into ${describeRelated(r.mergedInto)} — this ticket is a cancelled duplicate; undo the merge (ticket.unmerge) instead of changing its status`,
    );
  }
  if (r.mergedTicketCount > 0) lines.push(`Duplicates merged into this ticket: ${r.mergedTicketCount}`);
  return lines;
}
