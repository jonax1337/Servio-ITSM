import Link from "next/link";
import { Copy } from "lucide-react";
import { requireAgentUser } from "@/lib/session";
import { TICKET_STATUS_META } from "@/lib/constants";
import { findSimilarTickets, type SimilarTicket } from "@/lib/ai-similarity-search";
import { mergeTicket } from "@/lib/actions/tickets";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmButton } from "@/components/confirm-dialog";
import { LinkRelatedButton } from "@/components/ai/insights/link-related-button";

export type SimilarTicketsProps = {
  ticketId: number;
  /** "hint": compact banner above the conversation that points to the list; "full": list with actions on the Links tab. */
  variant: "hint" | "full";
  /** Agents may merge / link from the list. */
  canEdit: boolean;
};

/** The hint only speaks up for near-duplicates; the full list shows everything above the insight threshold. */
const HINT_MIN_SCORE = 0.5;
const HINT_MAX_ITEMS = 3;
const FULL_MAX_ITEMS = 8;

const percent = (score: number) => `${Math.round(score * 100)}%`;

/** Similar / duplicate ticket candidates for agents (local lexical match, no AI call). */
export async function SimilarTickets({ ticketId, variant, canEdit }: SimilarTicketsProps) {
  if (!(await requireAgentUser())) return null;
  const matches = await findSimilarTickets(ticketId, variant === "hint" ? HINT_MAX_ITEMS : FULL_MAX_ITEMS);
  return variant === "hint" ? (
    <SimilarHint ticketId={ticketId} matches={matches} />
  ) : (
    <SimilarList ticketId={ticketId} matches={matches} canEdit={canEdit} />
  );
}

function SimilarHint({ ticketId, matches }: { ticketId: number; matches: SimilarTicket[] }) {
  const likely = matches.filter((m) => m.score >= HINT_MIN_SCORE);
  if (likely.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Copy className="size-3.5 text-muted-foreground" />
        Similar tickets
      </span>
      {likely.map((m) => (
        <Link key={m.id} href={`/tickets/${m.id}`} className="text-primary hover:underline" title={`${m.title}. ${m.reason}`}>
          {m.ref} <span className="text-muted-foreground">({percent(m.score)} match{m.open ? "" : ", resolved"})</span>
        </Link>
      ))}
      <Link href={`/tickets/${ticketId}?tab=links`} className="ml-auto text-muted-foreground hover:text-foreground hover:underline">
        Merge or link
      </Link>
    </div>
  );
}

function SimilarList({ ticketId, matches, canEdit }: { ticketId: number; matches: SimilarTicket[]; canEdit: boolean }) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Copy className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Similar tickets</h2>
        <p className="ml-auto hidden text-xs text-muted-foreground sm:block">
          Open and recently resolved tickets with similar wording, category or service
        </p>
      </header>
      {matches.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          No similar tickets found. Tickets already linked to this one are not listed again.
        </p>
      ) : (
        <ul className="divide-y">
          {matches.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="grid min-w-0 gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/tickets/${m.id}`} className="font-medium hover:underline">
                    {m.ref}
                  </Link>
                  <StatusBadge map={TICKET_STATUS_META} value={m.status} />
                  <span className="text-xs tabular-nums text-muted-foreground">{percent(m.score)} match</span>
                </div>
                <p className="truncate text-sm">{m.title}</p>
                <p className="text-xs text-muted-foreground">{m.reason}</p>
              </div>
              {canEdit ? (
                <div className="flex shrink-0 items-center gap-2">
                  {m.open ? (
                    <ConfirmButton
                      action={mergeTicket}
                      fields={{ id: ticketId, targetId: m.id }}
                      title={`Merge into ${m.ref}?`}
                      description="This ticket is closed as a duplicate and its conversation moves to the target. You can undo the merge from this ticket afterwards."
                      confirmLabel="Merge"
                      confirmVariant="default"
                      triggerVariant="outline"
                      triggerSize="sm"
                    >
                      Merge into {m.ref}
                    </ConfirmButton>
                  ) : null}
                  <LinkRelatedButton ticketId={ticketId} targetId={m.id} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
