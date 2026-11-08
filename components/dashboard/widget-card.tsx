"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VolumeChart, BarRow, DonutChart, GaugeChart } from "@/components/charts";
import { StatusBadge } from "@/components/status-badge";
import { BriefingBody } from "@/components/dashboard/briefing-widget";
import { TICKET_STATUS_META, PRIORITY_META, TICKET_TYPE_META, LEVEL_META, SOURCE_META, ticketRef, type Meta } from "@/lib/constants";
import { defaultWidgetId, type BreakdownField, type Widget, type Computed, type Tone } from "@/lib/dashboard/types";
import { useEnumT, useFormatter, useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";
import type { EnumTranslator } from "@/lib/i18n/enums";
import type { Formatter } from "@/lib/i18n/format";

type I18n = { t: Translator<"dashboard">; te: EnumTranslator; f: Formatter };

const BREAKDOWN_MAPS: Partial<Record<BreakdownField, Record<string, Meta>>> = {
  priority: PRIORITY_META,
  status: TICKET_STATUS_META,
  type: TICKET_TYPE_META,
  impact: LEVEL_META,
  urgency: LEVEL_META,
  source: SOURCE_META,
};

/** A widget's title in the viewer's language when it is still the built-in default. */
export function useWidgetTitle(): (widget: Pick<Widget, "id" | "title">) => string {
  const t = useT("dashboard");
  return (widget) => {
    const id = defaultWidgetId(widget);
    return id ? t.dyn(`default.${id}`, undefined, widget.title) : widget.title;
  };
}

function useI18n(): I18n {
  return { t: useT("dashboard"), te: useEnumT(), f: useFormatter() };
}

/** A breakdown row's label in the viewer's language (the English label is the fallback). */
function breakdownLabel(row: { label: string; key?: string | null }, field: BreakdownField | undefined, { t, te }: I18n) {
  if (!field || row.key === undefined) return row.label;
  const map = BREAKDOWN_MAPS[field];
  if (map) return row.key ? te(map, row.key) : row.label;
  if (row.key === null) return field === "assignee" ? t("unassigned") : t("none");
  return row.label;
}

/** "2026-11-08" (a server-local calendar day) → the viewer's short date. */
function dayLabel(date: string | undefined, fallback: string, f: Formatter) {
  const m = date?.match(/^(d{4})-(d{2})-(d{2})$/);
  return m ? f.date(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), "dateShort") : fallback;
}

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
  const i18n = useI18n();
  const title = useWidgetTitle();
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
        <CardTitle className="text-sm">{title(widget)}</CardTitle>
      </CardHeader>
      <CardContent className={cn("min-h-0 flex-1", widgetBodyOverflow(data))}>{renderBody(data, i18n)}</CardContent>
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
  const i18n = useI18n();
  return renderBody(data, i18n);
}

function renderBody(data: Computed, i18n: I18n) {
  const { t, f } = i18n;
  switch (data.kind) {
    case "stat":
      return (
        <div className="flex h-full items-center">
          <span className="font-display text-4xl font-semibold tabular-nums tracking-tight">{data.value}</span>
        </div>
      );

    case "breakdown": {
      const total = data.rows.reduce((a, r) => a + r.value, 0);
      if (total === 0) return <Empty t={t} />;
      const rows = data.rows.map((r) => ({ ...r, label: breakdownLabel(r, data.field, i18n) }));
      if (data.chartType === "donut") return <DonutChart data={rows} />;
      return (
        <div className="grid gap-2">
          {rows.map((r, i) => {
            const bar = <BarRow label={r.label} value={r.value} total={total} colorVar={r.color ?? PALETTE[i % PALETTE.length]} />;
            return r.href ? (
              <Link key={r.key ?? r.label} href={r.href} className="block rounded-md px-1 py-0.5 transition-colors hover:bg-muted/60">
                {bar}
              </Link>
            ) : (
              <div key={r.key ?? r.label}>{bar}</div>
            );
          })}
        </div>
      );
    }

    case "aging": {
      const total = data.rows.reduce((a, r) => a + r.value, 0);
      if (total === 0) return <Empty t={t} />;
      return (
        <div className="grid gap-3">
          {data.rows.map((r, i) => (
            <BarRow key={r.label} label={r.key ? t(`aging.${r.key}`) : r.label} value={r.value} total={total} colorVar={PALETTE[i % PALETTE.length]} />
          ))}
        </div>
      );
    }

    case "volume":
      return (
        <div className="h-full min-h-[160px]">
          <VolumeChart data={data.data.map((d) => ({ ...d, label: dayLabel(d.date, d.label, f) }))} />
        </div>
      );

    case "sla":
      return (
        <div className="flex h-full flex-wrap items-center gap-5">
          {data.pct == null ? <Empty t={t} /> : <GaugeChart value={data.pct} label={t("slaMet")} />}
          <div className="grid gap-3">
            <Metric label={t("mttr")} value={data.mttrHours == null ? "—" : formatHours(data.mttrHours, t)} />
            <Metric label={t("resolved")} value={f.number(data.resolved)} muted />
          </div>
        </div>
      );

    case "csat":
      if (data.avg == null) return <Empty t={t} />;
      return (
        <div className="flex h-full flex-wrap items-center gap-5">
          <div className="flex items-baseline gap-1">
            <span className="font-display text-4xl font-semibold tabular-nums tracking-tight">
              {f.number(data.avg, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </span>
            <span className="text-lg text-muted-foreground">/ {data.max}</span>
          </div>
          <div className="grid gap-3">
            <Metric label={t("avgRating")} value={f.percent(data.avg / data.max)} />
            <Metric label={t("responses")} value={f.number(data.count)} muted />
          </div>
        </div>
      );

    case "list":
      if (data.tickets.length === 0) return <Empty t={t} />;
      return (
        <ul className="-mx-2 divide-y">
          {data.tickets.map((tk) => (
            <li key={tk.id}>
              <Link href={`/tickets/${tk.id}`} className="flex items-center gap-2.5 rounded-md px-2 py-2 hover:bg-muted/50">
                <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{ticketRef(tk.id, tk.prefix)}</span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{tk.title}</span>
                <StatusBadge map={PRIORITY_META} value={tk.priority} dot />
                <StatusBadge map={TICKET_STATUS_META} value={tk.status} />
              </Link>
            </li>
          ))}
        </ul>
      );

    case "briefing":
      return <BriefingBody sections={data.sections} aiAvailable={data.aiAvailable} />;

    default:
      return <Empty t={t} />;
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

function Empty({ t }: { t: Translator<"dashboard"> }) {
  return <p className="text-sm text-muted-foreground">{t("noData")}</p>;
}

function formatHours(h: number, t: Translator<"dashboard">) {
  if (h < 24) return t("hoursShort", { n: h });
  const d = Math.round((h / 24) * 10) / 10;
  return t("daysShort", { n: d });
}
