import { aiConfigured, aiTeaserEnabled } from "@/lib/ai";
import { requireUser, isAgent } from "@/lib/session";
import { TicketSummaryPanel } from "@/components/ai/ticket-summary-panel";

export type TicketSummaryCardProps = { ticketId: number };

/**
 * Collapsible AI thread summary (agents only). The summary is generated on demand when the card is
 * first opened; with AI off the card is a teaser (when enabled) or absent.
 */
export async function TicketSummaryCard({ ticketId }: TicketSummaryCardProps) {
  const me = await requireUser();
  if (!me || !isAgent(me.role)) return null;

  const enabled = await aiConfigured();
  const teaser = !enabled && (await aiTeaserEnabled());
  if (!enabled && !teaser) return null;

  return <TicketSummaryPanel ticketId={ticketId} teaser={teaser} />;
}
