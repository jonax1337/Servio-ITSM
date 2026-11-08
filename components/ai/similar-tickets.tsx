import Link from "next/link";
import { Copy } from "lucide-react";
import { requireAgentUser } from "@/lib/session";
import { TICKET_STATUS_META } from "@/lib/constants";
import { findSimilarTickets, type SimilarTicket } from "@/lib/ai-similarity-search";
import { mergeTicket } from "@/lib/actions/tickets";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmButton } from "@/components/confirm-dialog";
import { LinkRelatedButton } from "@/components/ai/insights/link-related-button";
import { getFormatter, getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate";
import type { Formatter } from "@/lib/i18n/format";

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

const percent = (score: number, f: Formatter) => f.percent(score);

/** Re-phrase lib/ai-similarity's English reason ("Shares “a”, “b” · same service") for the viewer. */
function reasonText(reason: string, t: Translator<"assistant">): string {
  return reason
    .split(" · ")
    .map((part) =>
      part.startsWith("Shares ")
        ? t("similar.shares", { terms: part.slice("Shares ".length) })
        : part === "same service"
          ? t("similar.sameService")
          : part === "same category"
            ? t("similar.sameCategory")
            : part === "Similar wording"
              ? t("similar.wording")
              : part,
    )
    .join(" · ");
}

/** Similar / duplicate ticket candidates for agents (local lexical match, no AI call). */
export async function SimilarTickets({ ticketId, variant, canEdit }: SimilarTicketsProps) {
  if (!(await requireAgentUser())) return null;
  const [matches, t, f] = await Promise.all([
    findSimilarTickets(ticketId, variant === "hint" ? HINT_MAX_ITEMS : FULL_MAX_ITEMS),
    getT("assistant"),
    getFormatter(),
  ]);
  return variant === "hint" ? (
    <SimilarHint ticketId={ticketId} matches={matches} t={t} f={f} />
  ) : (
    <SimilarList ticketId={ticketId} matches={matches} canEdit={canEdit} t={t} f={f} />
  );
}

type Labels = { t: Translator<"assistant">; f: Formatter };

function SimilarHint({ ticketId, matches, t, f }: { ticketId: number; matches: SimilarTicket[] } & Labels) {
  const likely = matches.filter((m) => m.score >= HINT_MIN_SCORE);
  if (likely.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Copy className="size-3.5 text-muted-foreground" />
        {t("similar.title")}
      </span>
      {likely.map((m) => (
        <Link key={m.id} href={`/tickets/${m.id}`} className="text-primary hover:underline" title={`${m.title}. ${reasonText(m.reason, t)}`}>
          {m.ref} <span className="text-muted-foreground">({t(m.open ? "similar.match" : "similar.matchResolved", { percent: percent(m.score, f) })})</span>
        </Link>
      ))}
      <Link href={`/tickets/${ticketId}?tab=links`} className="ml-auto text-muted-foreground hover:text-foreground hover:underline">
        {t("similar.mergeOrLink")}
      </Link>
    </div>
  );
}

function SimilarList({ ticketId, matches, canEdit, t, f }: { ticketId: number; matches: SimilarTicket[]; canEdit: boolean } & Labels) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Copy className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">{t("similar.title")}</h2>
        <p className="ml-auto hidden text-xs text-muted-foreground sm:block">
          {t("similar.subtitle")}
        </p>
      </header>
      {matches.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {t("similar.empty")}
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
                  <span className="text-xs tabular-nums text-muted-foreground">{t("similar.match", { percent: percent(m.score, f) })}</span>
                </div>
                <p className="truncate text-sm">{m.title}</p>
                <p className="text-xs text-muted-foreground">{reasonText(m.reason, t)}</p>
              </div>
              {canEdit ? (
                <div className="flex shrink-0 items-center gap-2">
                  {m.open ? (
                    <ConfirmButton
                      action={mergeTicket}
                      fields={{ id: ticketId, targetId: m.id }}
                      title={t("similar.mergeTitle", { ref: m.ref })}
                      description={t("similar.mergeDescription")}
                      confirmLabel={t("similar.merge")}
                      confirmVariant="default"
                      triggerVariant="outline"
                      triggerSize="sm"
                    >
                      {t("similar.mergeInto", { ref: m.ref })}
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
