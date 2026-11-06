/**
 * Dashboard widget model — pure types + the built-in default layout.
 * Kept free of server imports so client components can import it safely.
 * Coordinates (x/y/w/h) are on a 12-column grid, compatible with the
 * react-grid-layout editor added in phase 2.
 */

export type WidgetType = "stat" | "breakdown" | "volume" | "sla" | "aging" | "list" | "csat" | "briefing";

/** Every widget type, for validating layouts that come from the client. */
export const WIDGET_TYPES: readonly WidgetType[] = ["stat", "breakdown", "volume", "sla", "csat", "aging", "list", "briefing"];

/** A widget's own filters. Superset of the tickets-list vocabulary + a few flags. */
export type TicketFilters = Partial<
  Record<
    | "status" | "priority" | "type" | "group" | "assignee" | "category" | "service"
    | "impact" | "urgency" | "source" | "major" | "vip" | "breached" | "sla" | "days",
    string
  >
>;

/** How a "breakdown" widget groups tickets. */
export type BreakdownField =
  | "priority" | "status" | "type" | "assignee" | "group" | "category"
  | "service" | "source" | "impact" | "urgency";

/** A tone/colour a widget can use for its accent or a threshold state. */
export type Tone = "primary" | "success" | "warning" | "danger" | "info" | "neutral";

/** A value-based colouring rule for a "stat" widget (first match wins). */
export type Threshold = { op: "lt" | "lte" | "gt" | "gte" | "eq"; value: number; tone: Tone };

export type Widget = {
  id: string;
  type: WidgetType;
  title: string;
  filters: TicketFilters;
  x: number;
  y: number;
  w: number; // columns (1–12)
  h: number; // row units
  options?: {
    groupBy?: BreakdownField;
    chartType?: "bar" | "donut";
    /** Fixed accent colour for the card. */
    accent?: Tone;
    /** Value-based colouring for stat widgets. */
    thresholds?: Threshold[];
  };
};

/** One line of the daily briefing: a record the viewer should look at. `detail` says why. */
export type BriefingItem = { label: string; detail: string; href: string; tone?: Tone };

export type BriefingSectionKey = "sla" | "customer" | "approvals" | "changes";

/** `total` counts every match; `items` holds only the first few. */
export type BriefingSection = { key: BriefingSectionKey; title: string; total: number; items: BriefingItem[] };

/** The computed payload the renderer switches on (data resolved server-side). */
export type Computed =
  | { kind: "stat"; value: number; href?: string; tone?: Tone }
  | { kind: "breakdown"; rows: { label: string; value: number; href?: string; color?: string }[]; chartType?: "bar" | "donut" }
  | { kind: "aging"; rows: { label: string; value: number }[] }
  | { kind: "volume"; data: { label: string; created: number; resolved: number }[] }
  | { kind: "sla"; pct: number | null; mttrHours: number | null; resolved: number; href?: string }
  | { kind: "csat"; avg: number | null; count: number; max: number }
  | { kind: "list"; tickets: { id: number; prefix: string; title: string; status: string; priority: string }[] }
  | { kind: "briefing"; sections: BriefingSection[]; aiAvailable: boolean }
  | { kind: "empty" };

export const WIDGET_LABELS: Record<WidgetType, string> = {
  stat: "Number",
  breakdown: "Breakdown",
  volume: "Volume trend",
  sla: "SLA & MTTR",
  aging: "Ticket aging",
  list: "Ticket list",
  csat: "CSAT",
  briefing: "Daily briefing",
};

/** Built-in default dashboard, shown when a user has none of their own yet. */
export const DEFAULT_LAYOUT: Widget[] = [
  { id: "d-open", type: "stat", title: "Open tickets", filters: { status: "open" }, x: 0, y: 0, w: 3, h: 1 },
  { id: "d-unassigned", type: "stat", title: "Unassigned", filters: { status: "open", assignee: "unassigned" }, x: 3, y: 0, w: 3, h: 1 },
  { id: "d-critical", type: "stat", title: "Critical open", filters: { status: "open", priority: "CRITICAL" }, x: 6, y: 0, w: 3, h: 1 },
  // Two rows tall: the gauge plus MTTR/Resolved need more than one 120px row.
  { id: "d-sla", type: "sla", title: "SLA & MTTR · 14d", filters: { days: "14" }, x: 9, y: 0, w: 3, h: 2 },
  { id: "d-sla-breached", type: "stat", title: "SLA breached", filters: { sla: "breached" }, options: { accent: "danger" }, x: 0, y: 1, w: 3, h: 1 },
  { id: "d-sla-at-risk", type: "stat", title: "SLA at risk", filters: { sla: "at_risk" }, options: { accent: "warning" }, x: 3, y: 1, w: 3, h: 1 },
  { id: "d-csat", type: "csat", title: "CSAT · 30d", filters: { days: "30" }, x: 6, y: 1, w: 3, h: 1 },
  { id: "d-volume", type: "volume", title: "Ticket volume", filters: { days: "14" }, x: 0, y: 2, w: 8, h: 2 },
  { id: "d-priority", type: "breakdown", title: "Open by priority", filters: { status: "open" }, options: { groupBy: "priority", chartType: "donut" }, x: 8, y: 2, w: 4, h: 2 },
  { id: "d-workload", type: "breakdown", title: "Open per agent", filters: { status: "open" }, options: { groupBy: "assignee" }, x: 0, y: 4, w: 6, h: 2 },
  { id: "d-aging", type: "aging", title: "Open ticket aging", filters: { status: "open" }, x: 6, y: 4, w: 6, h: 2 },
  { id: "d-recent", type: "list", title: "Recent tickets", filters: {}, x: 0, y: 6, w: 12, h: 2 },
];
