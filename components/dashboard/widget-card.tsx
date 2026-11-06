import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VolumeChart, BarRow, DonutChart, GaugeChart } from "@/components/charts";
import { StatusBadge } from "@/components/status-badge";
import { BriefingBody } from "@/components/dashboard/briefing-widget";
import { TICKET_STATUS_META, PRIORITY_META, ticketRef } from "@/lib/constants";
import type { Widget, Computed, Tone } from "@/lib/dashboard/types";

/** Subtle full-card tint (background + border) per tone. */
const TONE_TINT: Record<Tone, string> = {
  primary: "border-primary/30 bg-primary/5",
  success: "border-emerald-500/40 bg-emerald-500/10",
  warning: "border-amber-500/40 bg-amber-500/10",
  danger: "border-red-500/40 bg-red-500/10",
  info: "border-sky-500/40 bg-sky-500/10",
  neutral: "border-border bg-muted/40",
};

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-3)",
  "oklch(0.72 0.16 70)",
  "var(--chart-4)",
  "var(--primary)",
  "var(--muted-foreground)",
];

/** Renders one dashboard widget from its server-computed data. */
export function WidgetCard({ widget, data }: { widget: Widget; data: Computed }) {
  // Tint the whole card: a stat's threshold-resolved tone wins, else the widget accent.
  const cardTone = (data.kind === "stat" ? data.tone : undefined) ?? widget.options?.accent;
  // Single-metric cards drill into their filtered ticket list from anywhere on the card.
  const cardHref = data.kind === "stat" || data.kind === "sla" ? data.href : undefined;

  const card = (
    <Card
      className={cn(
        "flex h-full flex-col transition-colors",
        cardTone && TONE_TINT[cardTone],
        cardHref && "hover:border-primary/50",
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{widget.title}</CardTitle>
      </CardHeader>
      <CardContent className={cn("min-h-0 flex-1", widgetBodyOverflow(data))}>{renderBody(data)}</CardContent>
    </Card>
  );

  return cardHref ? (
    <Link href={cardHref} className="block h-full">{card}</Link>
  ) : (
    card
  );
}

/**
 * Only row-based bodies may scroll. Stat numbers and charts get `overflow-hidden`:
 * as scroll containers, a 2px glyph overflow showed a stray scrollbar, and a chart
 * tooltip poking out toggled a scrollbar that resized the chart under the cursor.
 */
export function widgetBodyOverflow(data: Computed): string {
  const rowBased =
    data.kind === "list" ||
    data.kind === "aging" ||
    data.kind === "briefing" ||
    (data.kind === "breakdown" && data.chartType !== "donut");
  return rowBased ? "overflow-auto" : "overflow-hidden";
}

/** Just the body of a widget (no card chrome) — reused by the editor canvas. */
export function WidgetBody({ data }: { data: Computed }) {
  return renderBody(data);
}

function renderBody(data: Computed) {
  switch (data.kind) {
    case "stat":
      return (
        <div className="flex h-full items-center">
          <span className="font-display text-4xl font-semibold tabular-nums tracking-tight">{data.value}</span>
        </div>
      );

    case "breakdown": {
      const total = data.rows.reduce((a, r) => a + r.value, 0);
      if (total === 0) return <Empty />;
      if (data.chartType === "donut") return <DonutChart data={data.rows} />;
      return (
        <div className="grid gap-2">
          {data.rows.map((r, i) => {
            const bar = <BarRow label={r.label} value={r.value} total={total} colorVar={r.color ?? PALETTE[i % PALETTE.length]} />;
            return r.href ? (
              <Link key={r.label} href={r.href} className="block rounded-md px-1 py-0.5 transition-colors hover:bg-muted/60">
                {bar}
              </Link>
            ) : (
              <div key={r.label}>{bar}</div>
            );
          })}
        </div>
      );
    }

    case "aging": {
      const total = data.rows.reduce((a, r) => a + r.value, 0);
      if (total === 0) return <Empty />;
      return (
        <div className="grid gap-3">
          {data.rows.map((r, i) => (
            <BarRow key={r.label} label={r.label} value={r.value} total={total} colorVar={PALETTE[i % PALETTE.length]} />
          ))}
        </div>
      );
    }

    case "volume":
      return (
        <div className="h-full min-h-[160px]">
          <VolumeChart data={data.data} />
        </div>
      );

    case "sla":
      return (
        <div className="flex h-full flex-wrap items-center gap-5">
          {data.pct == null ? <Empty /> : <GaugeChart value={data.pct} label="SLA met" />}
          <div className="grid gap-3">
            <Metric label="MTTR" value={data.mttrHours == null ? "—" : formatHours(data.mttrHours)} />
            <Metric label="Resolved" value={String(data.resolved)} muted />
          </div>
        </div>
      );

    case "csat":
      if (data.avg == null) return <Empty />;
      return (
        <div className="flex h-full flex-wrap items-center gap-5">
          <div className="flex items-baseline gap-1">
            <span className="font-display text-4xl font-semibold tabular-nums tracking-tight">
              {data.avg.toFixed(1)}
            </span>
            <span className="text-lg text-muted-foreground">/ {data.max}</span>
          </div>
          <div className="grid gap-3">
            <Metric label="Avg rating" value={`${Math.round((data.avg / data.max) * 100)}%`} />
            <Metric label="Responses" value={String(data.count)} muted />
          </div>
        </div>
      );

    case "list":
      if (data.tickets.length === 0) return <Empty />;
      return (
        <ul className="-mx-2 divide-y">
          {data.tickets.map((t) => (
            <li key={t.id}>
              <Link href={`/tickets/${t.id}`} className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-muted/50">
                <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{ticketRef(t.id, t.prefix)}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span>
                <StatusBadge map={PRIORITY_META} value={t.priority} dot />
                <StatusBadge map={TICKET_STATUS_META} value={t.status} />
              </Link>
            </li>
          ))}
        </ul>
      );

    case "briefing":
      return <BriefingBody sections={data.sections} aiAvailable={data.aiAvailable} />;

    default:
      return <Empty />;
  }
}

function Metric({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="grid gap-0.5">
      <span className={`font-display text-3xl font-semibold tabular-nums tracking-tight ${muted ? "text-muted-foreground" : ""}`}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-muted-foreground">No data.</p>;
}

function formatHours(h: number) {
  if (h < 24) return `${h}h`;
  const d = Math.round((h / 24) * 10) / 10;
  return `${d}d`;
}
