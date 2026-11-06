/**
 * Pure drafts of the records an agent creates from tickets: a problem raised for one
 * or several incidents. The raise-problem dialog prefills its fields from these.
 */
import { clipTitle } from "@/lib/ai-insights-rules";
import { ticketRef } from "@/lib/constants";

type DraftTicket = { id: number; prefix: string; title: string; description?: string };

/** Title and description to prefill when raising a problem for `tickets` (the lowest id names it). */
export function problemDraftFromTickets(tickets: readonly DraftTicket[]): { title: string; description: string } {
  const [first, ...rest] = [...tickets].sort((a, b) => a.id - b.id);
  if (!first) return { title: "", description: "" };
  if (rest.length === 0) {
    const raisedFrom = `Raised from ${ticketRef(first.id, first.prefix)}.`;
    const description = first.description?.trim();
    return { title: clipTitle(first.title), description: description ? `${description}\n\n${raisedFrom}` : raisedFrom };
  }
  const lines = [first, ...rest].map((t) => `- ${ticketRef(t.id, t.prefix)}: ${t.title}`);
  return {
    title: clipTitle(`Recurring: ${first.title}`),
    description: `Raised from ${lines.length} related incidents:\n${lines.join("\n")}`,
  };
}

/** Whether a ticket in this status has a resolution an article can be written from. */
export function canDraftArticleFrom(status: string): boolean {
  return status === "RESOLVED" || status === "CLOSED";
}
