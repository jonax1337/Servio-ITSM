import { EntityHistory } from "@/components/history/entity-history";

/** History tab: the full audit timeline of the ticket, newest first. */
export function HistoryTab({ ticketId }: { ticketId: number }) {
  return <EntityHistory entity="Ticket" entityId={String(ticketId)} limit={100} />;
}
