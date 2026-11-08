import Link from "next/link";
import { AI_INSIGHT_KIND_META, TICKET_STATUS_META, ticketRef } from "@/lib/constants";
import { parseKbGapPayload } from "@/lib/ai-insights-rules";
import { StatusBadge } from "@/components/status-badge";
import { InsightActions } from "@/components/ai/insights/insight-actions";
import { getFormatter, getT } from "@/lib/i18n/server";

export type InsightCardData = {
  id: string;
  kind: string;
  title: string;
  summary: string | null;
  payload: string;
  createdAt: Date;
  tickets: { id: number; prefix: string; title: string; status: string }[];
};

const MAX_TICKET_ROWS = 5;

export async function InsightCard({ insight }: { insight: InsightCardData }) {
  const [t, f] = await Promise.all([getT("assistant"), getFormatter()]);
  const isCluster = insight.kind === "CLUSTER";
  const tickets = [...insight.tickets].sort((a, b) => a.id - b.id);
  const shown = tickets.slice(0, MAX_TICKET_ROWS);
  const fixByTicket = new Map(
    isCluster ? [] : parseKbGapPayload(insight.payload).resolutions.map((r) => [r.ticketId, r.note] as const),
  );

  return (
    <article className="grid gap-3 rounded-xl border bg-card p-4">
      <header className="flex flex-wrap items-center gap-2">
        <StatusBadge map={AI_INSIGHT_KIND_META} value={insight.kind} />
        <span className="text-xs text-muted-foreground">{t("insight.noticed", { when: f.relative(insight.createdAt) })}</span>
      </header>

      <div className="grid gap-1">
        <h3 className="font-medium">{insight.title}</h3>
        {insight.summary ? <p className="text-sm text-muted-foreground">{insight.summary}</p> : null}
      </div>

      <ul className="divide-y rounded-lg border">
        {shown.map((row) => (
          <li key={row.id} className="grid gap-0.5 px-3 py-2 text-sm">
            <Link href={`/tickets/${row.id}`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 hover:text-primary">
              <span className="font-mono text-xs text-muted-foreground">{ticketRef(row.id, row.prefix)}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{row.title}</span>
              <StatusBadge map={TICKET_STATUS_META} value={row.status} />
            </Link>
            {fixByTicket.has(row.id) ? <p className="text-xs text-muted-foreground">{t("insight.fix", { note: fixByTicket.get(row.id) })}</p> : null}
          </li>
        ))}
        {tickets.length > shown.length ? (
          <li className="px-3 py-2 text-xs text-muted-foreground">{t("insight.moreTickets", { count: tickets.length - shown.length })}</li>
        ) : null}
      </ul>

      <InsightActions
        insightId={insight.id}
        kind={isCluster ? "CLUSTER" : "KB_GAP"}
        majorIncidentTicket={isCluster && tickets[0] ? { id: tickets[0].id, ref: ticketRef(tickets[0].id, tickets[0].prefix) } : undefined}
      />
    </article>
  );
}
