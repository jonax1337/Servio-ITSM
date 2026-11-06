import { unstable_cache } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  OPEN_TICKET_STATUSES,
  PRIORITY_META,
  TICKET_STATUS_META,
  TICKET_TYPE_META,
  LEVEL_META,
  SOURCE_META,
  SURVEY_RATING_MAX,
} from "@/lib/constants";
import type { Widget, Computed, TicketFilters, BreakdownField, Threshold, Tone } from "@/lib/dashboard/types";
import { findSlaViewTicketIds, parseSlaView } from "@/lib/sla-views";

/** First matching threshold wins; falls back to undefined (caller uses the accent). */
function resolveThresholdTone(value: number, thresholds?: Threshold[]): Tone | undefined {
  if (!thresholds?.length) return undefined;
  for (const t of thresholds) {
    const ok =
      t.op === "lt" ? value < t.value
      : t.op === "lte" ? value <= t.value
      : t.op === "gt" ? value > t.value
      : t.op === "gte" ? value >= t.value
      : value === t.value;
    if (ok) return t.tone;
  }
  return undefined;
}

/** Turn a widget's filter map into a Prisma ticket `where`. Mirrors /tickets. */
export function buildTicketWhere(f: TicketFilters): Prisma.TicketWhereInput {
  const w: Prisma.TicketWhereInput = {};
  if (f.status === "open") w.status = { in: [...OPEN_TICKET_STATUSES] };
  else if (f.status && f.status !== "all") w.status = f.status;
  if (f.priority && f.priority !== "all") w.priority = f.priority;
  if (f.type && f.type !== "all") w.type = f.type;
  if (f.group && f.group !== "all") w.groupId = f.group;
  if (f.assignee === "unassigned") w.assigneeId = null;
  else if (f.assignee && f.assignee !== "all") w.assigneeId = f.assignee;
  if (f.category && f.category !== "all") w.categoryId = f.category;
  if (f.service && f.service !== "all") w.serviceId = f.service;
  if (f.impact && f.impact !== "all") w.impact = f.impact;
  if (f.urgency && f.urgency !== "all") w.urgency = f.urgency;
  if (f.source && f.source !== "all") w.source = f.source;
  if (f.major === "true") w.isMajorIncident = true;
  if (f.vip === "true") w.requester = { isVip: true };
  // SLA breached = already flagged breached, or an unresolved ticket past its
  // resolve deadline. The `resolvedAt: null` guard stops already-resolved/closed
  // met-SLA tickets counting as breached (mirrors lib/ai-stats.ts:123).
  if (f.breached === "true") {
    const breachedOr: Prisma.TicketWhereInput[] = [
      { resolveBreached: true },
      { resolveDueAt: { lt: new Date() }, resolvedAt: null },
    ];
    // Don't clobber a pre-existing OR; AND the two disjunctions together.
    if (w.OR) {
      const existingAnd = Array.isArray(w.AND) ? w.AND : w.AND ? [w.AND] : [];
      w.AND = [...existingAnd, { OR: w.OR }, { OR: breachedOr }];
      delete w.OR;
    } else {
      w.OR = breachedOr;
    }
  }
  return w;
}

/**
 * `buildTicketWhere` plus the filters that need the live SLA clock (`sla`): those
 * resolve to the ids currently in the view, so this one is async.
 */
export async function resolveTicketWhere(f: TicketFilters): Promise<Prisma.TicketWhereInput> {
  const where = buildTicketWhere(f);
  const view = parseSlaView(f.sla);
  if (!view) return where;
  return { AND: [where, { id: { in: await findSlaViewTicketIds(view) } }] };
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const TICKETS_HREF_KEYS: (keyof TicketFilters)[] = [
  "status", "priority", "type", "group", "assignee", "category", "service",
  "impact", "urgency", "source", "major", "vip", "breached", "sla",
];

/**
 * A /tickets URL carrying this widget's filters — optionally overriding one
 * dimension (e.g. the clicked breakdown segment). Makes widgets drill down into
 * the exact filtered ticket list. The tickets page honours the same params.
 */
export function ticketsHref(filters: TicketFilters, over?: { field: string; value: string | null }): string {
  const p = new URLSearchParams();
  for (const k of TICKETS_HREF_KEYS) {
    const v = filters[k];
    if (v) p.set(k, v);
  }
  if (over) {
    if (over.value === null) {
      if (over.field === "assignee") p.set("assignee", "unassigned");
      else p.delete(over.field);
    } else {
      p.set(over.field, over.value);
    }
  }
  const qs = p.toString();
  return qs ? `/tickets?${qs}` : "/tickets";
}

const GROUP_COL: Record<BreakdownField, string> = {
  priority: "priority",
  status: "status",
  type: "type",
  assignee: "assigneeId",
  group: "groupId",
  category: "categoryId",
  service: "serviceId",
  source: "source",
  impact: "impact",
  urgency: "urgency",
};

/** Map the app's badge `tone`s to a solid chart colour so charts match the UI. */
const TONE_COLOR: Record<string, string> = {
  neutral: "var(--muted-foreground)",
  info: "#0ea5e9", // sky-500
  success: "#10b981", // emerald-500
  warning: "#f59e0b", // amber-500
  danger: "#ef4444", // red-500
  purple: "#a855f7", // purple-500
  indigo: "#6366f1", // indigo-500
};

async function computeBreakdown(widget: Widget, where: Prisma.TicketWhereInput): Promise<Computed> {
  const field = widget.options?.groupBy ?? "priority";
  const col = GROUP_COL[field];
  // Dynamic groupBy key — Prisma's types want a literal, so we cast the call.
  const grouped = (await (db.ticket.groupBy as unknown as (args: unknown) => Promise<
    Array<Record<string, unknown> & { _count: { _all: number } }>
  >)({ by: [col], where, _count: { _all: true } }));

  // Enum groupings share the app's *_META (labels + tones, so charts match the badges);
  // id-based groupings (assignee/group/category/service) need a name lookup instead.
  const metaRec: Record<string, { label: string; tone: string }> | null =
    field === "priority" ? PRIORITY_META
    : field === "status" ? TICKET_STATUS_META
    : field === "type" ? TICKET_TYPE_META
    : field === "impact" || field === "urgency" ? LEVEL_META
    : field === "source" ? SOURCE_META
    : null;

  let labelFor: (key: string | null) => string;
  if (metaRec) {
    labelFor = (k) => (k ? metaRec[k]?.label ?? k : "—");
  } else {
    const ids = grouped.map((g) => g[col]).filter((v): v is string => typeof v === "string");
    const map = new Map<string, string>();
    if (field === "assignee") {
      const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
      users.forEach((u) => map.set(u.id, u.name ?? u.email));
    } else if (field === "group") {
      const groups = await db.group.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      groups.forEach((g) => map.set(g.id, g.name));
    } else if (field === "service") {
      const services = await db.service.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      services.forEach((s) => map.set(s.id, s.name));
    } else {
      const cats = await db.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
      cats.forEach((c) => map.set(c.id, c.name));
    }
    labelFor = (k) => (k ? map.get(k) ?? k : field === "assignee" ? "Unassigned" : "None");
  }
  // Semantic colour from the value's tone (enum groupings only); id groupings fall
  // back to the renderer's palette.
  const colorFor = (k: string | null): string | undefined =>
    metaRec && k ? TONE_COLOR[metaRec[k]?.tone ?? "neutral"] ?? TONE_COLOR.neutral : undefined;

  const rows = grouped
    .map((g) => {
      const raw = (g[col] as string | null) ?? null;
      return {
        label: labelFor(raw),
        value: g._count._all,
        href: ticketsHref(widget.filters, { field, value: raw }),
        color: colorFor(raw),
      };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  return { kind: "breakdown", rows, chartType: widget.options?.chartType ?? "bar" };
}

async function computeVolume(widget: Widget, filters: TicketFilters): Promise<Computed> {
  const days = Math.min(90, Math.max(7, Number(filters.days) || 14));
  // Volume ignores the status filter (we count created & resolved over time).
  const base = await resolveTicketWhere({ ...filters, status: undefined });
  const from = startOfDay(new Date(Date.now() - (days - 1) * 86400000));
  const rows = await db.ticket.findMany({
    where: { AND: [base, { OR: [{ createdAt: { gte: from } }, { resolvedAt: { gte: from } }] }] },
    select: { createdAt: true, resolvedAt: true },
  });
  const buckets: { label: string; created: number; resolved: number; key: string }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = startOfDay(new Date(Date.now() - i * 86400000));
    buckets.push({
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      created: 0,
      resolved: 0,
    });
  }
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  for (const t of rows) {
    const ck = startOfDay(t.createdAt).toISOString().slice(0, 10);
    if (idx.has(ck)) buckets[idx.get(ck)!].created++;
    if (t.resolvedAt) {
      const rk = startOfDay(t.resolvedAt).toISOString().slice(0, 10);
      if (idx.has(rk)) buckets[idx.get(rk)!].resolved++;
    }
  }
  return { kind: "volume", data: buckets.map(({ label, created, resolved }) => ({ label, created, resolved })) };
}

async function computeSla(filters: TicketFilters): Promise<Computed> {
  const days = Math.min(90, Math.max(7, Number(filters.days) || 14));
  const windowStart = new Date(Date.now() - days * 86400000);
  const now = new Date();
  const base = await resolveTicketWhere({ ...filters, status: undefined });
  const href = ticketsHref(filters);

  // Resolved-in-window tickets carry MTTR; those that ran under an SLA also carry
  // the met/breached signal (a ticket with no SLA can neither meet nor miss one).
  const rows = await db.ticket.findMany({
    where: { AND: [base, { resolvedAt: { gte: windowStart } }] },
    select: { createdAt: true, resolvedAt: true, resolveBreached: true, resolveDueAt: true },
  });
  // Live breaches: still-active, unpaused tickets already past their resolve
  // deadline. Excluding these made compliance look better the more work was
  // overdue. Cancelled tickets never resolve and paused ones have a stale
  // (not yet shifted) deadline, so neither counts.
  const openBreached = await db.ticket.count({
    where: {
      AND: [
        base,
        { resolvedAt: null, pendingSince: null },
        { status: { notIn: ["RESOLVED", "CLOSED", "CANCELLED", "PENDING", "ON_HOLD"] } },
        { resolveDueAt: { lt: now } },
      ],
    },
  });

  const resolved = rows.length;
  const underSla = rows.filter((r) => r.resolveDueAt);
  const denom = underSla.length + openBreached;
  const totalMs = rows.reduce((a, r) => a + (r.resolvedAt!.getTime() - r.createdAt.getTime()), 0);
  const mttrHours = resolved === 0 ? null : Math.round(totalMs / resolved / 3600000);
  if (denom === 0) return { kind: "sla", pct: null, mttrHours, resolved, href };

  // Resolution SLA: resolved-on-time over (resolved under an SLA + live open breaches).
  const resolutionMet = underSla.filter((r) => !r.resolveBreached).length;
  const pct = Math.round((resolutionMet / denom) * 100);
  return { kind: "sla", pct, mttrHours, resolved, href };
}

/**
 * CSAT: average rating (1..MAX) over surveys answered in the window. We key off
 * the survey's respondedAt (when the customer rated) rather than the ticket's
 * resolvedAt, so a late response still counts. The widget's ticket filters still
 * apply (via the survey→ticket relation) so a per-group/service CSAT works too.
 */
async function computeCsat(filters: TicketFilters): Promise<Computed> {
  const days = Math.min(365, Math.max(7, Number(filters.days) || 30));
  const windowStart = new Date(Date.now() - days * 86400000);
  const base = await resolveTicketWhere({ ...filters, status: undefined });
  const agg = await db.surveyResponse.aggregate({
    where: {
      respondedAt: { gte: windowStart },
      rating: { not: null },
      ticket: base,
    },
    _avg: { rating: true },
    _count: { rating: true },
  });
  const count = agg._count.rating;
  const avg = count > 0 && agg._avg.rating != null ? Math.round(agg._avg.rating * 10) / 10 : null;
  return { kind: "csat", avg, count, max: SURVEY_RATING_MAX };
}

async function computeAging(where: Prisma.TicketWhereInput): Promise<Computed> {
  // Bucket by ticket age with four bounded COUNT queries on createdAt (indexed)
  // instead of loading every matching ticket's createdAt into JS. Portable
  // Prisma only — no dialect SQL. Cumulative counts: c1 = age < 1d, c3 = age
  // < 3d, c7 = age < 7d, total = all matches; buckets are their differences.
  const now = Date.now();
  const d1 = new Date(now - 86400000);
  const d3 = new Date(now - 3 * 86400000);
  const d7 = new Date(now - 7 * 86400000);
  const [c1, c3, c7, total] = await Promise.all([
    db.ticket.count({ where: { AND: [where, { createdAt: { gt: d1 } }] } }),
    db.ticket.count({ where: { AND: [where, { createdAt: { gt: d3 } }] } }),
    db.ticket.count({ where: { AND: [where, { createdAt: { gt: d7 } }] } }),
    db.ticket.count({ where }),
  ]);
  return {
    kind: "aging",
    rows: [
      { label: "< 1 day", value: c1 },
      { label: "1–3 days", value: c3 - c1 },
      { label: "3–7 days", value: c7 - c3 },
      { label: "> 7 days", value: total - c7 },
    ],
  };
}

const TONES = ["primary", "success", "warning", "danger", "info", "neutral"];
const OPS = ["lt", "lte", "gt", "gte", "eq"];

/**
 * Validate + normalise a widget's options (colours/thresholds/groupBy are never
 * trusted). The live widget-preview route (`/api/dashboard/widget`) forwards the
 * client's raw `options`, so we re-sanitise here rather than trust it — mirrors
 * `sanitizeOptions` in lib/actions/dashboards.ts.
 */
function sanitizeOptions(o: unknown): Widget["options"] | undefined {
  if (!o || typeof o !== "object") return undefined;
  const w = o as Record<string, unknown>;
  const out: NonNullable<Widget["options"]> = {};
  if (typeof w.groupBy === "string" && w.groupBy in GROUP_COL) out.groupBy = w.groupBy as BreakdownField;
  if (w.chartType === "bar" || w.chartType === "donut") out.chartType = w.chartType;
  if (typeof w.accent === "string" && TONES.includes(w.accent)) out.accent = w.accent as Tone;
  if (Array.isArray(w.thresholds)) {
    const cleaned = w.thresholds
      .slice(0, 5)
      .map((t) => {
        const tt = t as Record<string, unknown>;
        const value = Number(tt.value);
        return OPS.includes(tt.op as string) && Number.isFinite(value) && TONES.includes(tt.tone as string)
          ? ({ op: tt.op as Threshold["op"], value, tone: tt.tone as Tone })
          : null;
      })
      .filter((t): t is Threshold => t !== null);
    if (cleaned.length) out.thresholds = cleaned;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Resolve one widget's data (uncached inner). */
async function computeWidgetUncached(widget: Widget): Promise<Computed> {
  const where = await resolveTicketWhere(widget.filters);
  switch (widget.type) {
    case "stat": {
      const value = await db.ticket.count({ where });
      const tone = resolveThresholdTone(value, widget.options?.thresholds) ?? widget.options?.accent;
      return { kind: "stat", value, href: ticketsHref(widget.filters), tone };
    }
    case "breakdown":
      return computeBreakdown(widget, where);
    case "volume":
      return computeVolume(widget, widget.filters);
    case "sla":
      return computeSla(widget.filters);
    case "csat":
      return computeCsat(widget.filters);
    case "aging":
      return computeAging(where);
    case "list": {
      const tickets = await db.ticket.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: 6,
        select: { id: true, prefix: true, title: true, status: true, priority: true },
      });
      return { kind: "list", tickets };
    }
    default:
      return { kind: "empty" };
  }
}

/** Cache tag for dashboard widget aggregates — revalidate on ticket writes. */
export const DASHBOARD_CACHE_TAG = "dashboard-widgets";

/**
 * Resolve one widget's data. Wraps the ~9 full-table aggregate queries a home
 * load fires in `unstable_cache` (now that the ticket columns are indexed): a
 * short revalidate absorbs bursts while keeping the numbers near-live, and the
 * tag lets ticket mutations bust the cache on demand. The cache key is derived
 * only from the data-affecting fields (type/filters/options) — id/x/y/w/h don't
 * change the result — and untrusted `options` are re-sanitised first.
 */
export async function computeWidget(widget: Widget): Promise<Computed> {
  // The briefing is the viewer's own queue: caching it under the shared widget key would leak it to other users.
  // Loaded lazily: the briefing pulls in the session and AI layers, which the pure filter helpers here (and their tests) must not depend on.
  if (widget.type === "briefing") return (await import("@/lib/dashboard/briefing")).computeBriefing();
  const safe: Widget = { ...widget, options: sanitizeOptions(widget.options) };
  const key = JSON.stringify({ type: safe.type, filters: safe.filters, options: safe.options });
  const cached = unstable_cache(
    () => computeWidgetUncached(safe),
    ["dashboard-widget", key],
    { revalidate: 60, tags: [DASHBOARD_CACHE_TAG] },
  );
  return cached();
}
