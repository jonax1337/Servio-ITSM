/**
 * Pure rules for Sable insights (incident clusters and knowledge gaps): tuning
 * settings, dedupe keys, stored payloads and the texts / records derived from
 * them. Database and AI calls live in lib/ai-insights*.ts.
 */
import { z } from "zod";
import { IMPACT_URGENCY, PRIORITIES, ticketRef } from "@/lib/constants";

export type InsightConfig = {
  clusterMinTickets: number;
  clusterWindowHours: number;
  similarityThreshold: number;
  kbGapMinTickets: number;
  kbGapWindowDays: number;
};

/** Defaults of the `INSIGHT_*` settings; also what an out-of-range value falls back to. */
export const INSIGHT_DEFAULTS: InsightConfig = {
  clusterMinTickets: 3,
  clusterWindowHours: 24,
  similarityThreshold: 0.35,
  kbGapMinTickets: 3,
  kbGapWindowDays: 30,
};

const MIN_GROUP_SIZE = 2;
const MIN_THRESHOLD = 0.05;
const MAX_THRESHOLD = 0.95;
const MAX_TITLE_CHARS = 120;
const MAX_NOTE_CHARS = 400;

const atLeast = (value: number, min: number, fallback: number) => (Number.isFinite(value) && value >= min ? value : fallback);

/** Clamps raw setting values so a typo can't switch detection off or make every ticket a cluster. */
export function normalizeInsightConfig(raw: InsightConfig): InsightConfig {
  return {
    clusterMinTickets: Math.floor(atLeast(raw.clusterMinTickets, MIN_GROUP_SIZE, INSIGHT_DEFAULTS.clusterMinTickets)),
    clusterWindowHours: atLeast(raw.clusterWindowHours, 1, INSIGHT_DEFAULTS.clusterWindowHours),
    similarityThreshold: Number.isFinite(raw.similarityThreshold)
      ? Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, raw.similarityThreshold))
      : INSIGHT_DEFAULTS.similarityThreshold,
    kbGapMinTickets: Math.floor(atLeast(raw.kbGapMinTickets, MIN_GROUP_SIZE, INSIGHT_DEFAULTS.kbGapMinTickets)),
    kbGapWindowDays: atLeast(raw.kbGapWindowDays, 1, INSIGHT_DEFAULTS.kbGapWindowDays),
  };
}

// ---- dedupe ---------------------------------------------------------------

/** Keyed by the cluster's lowest ticket id: later members joining don't raise a second insight. */
export const clusterDedupeKey = (seedId: number) => `cluster:${seedId}`;
export const kbGapDedupeKey = (seedId: number) => `kb-gap:${seedId}`;

/**
 * True when half or more of the tickets already belong to an insight of the same
 * kind (open, actioned or dismissed). Keeps a cluster that outlives its seed
 * ticket's time window, or re-forms around a different seed, from being raised again.
 */
export function isMostlyCovered(ticketIds: readonly number[], coveredIds: ReadonlySet<number>): boolean {
  const covered = ticketIds.filter((id) => coveredIds.has(id)).length;
  return covered * 2 >= ticketIds.length;
}

// ---- stored payloads --------------------------------------------------------

const clusterPayload = z.object({ terms: z.array(z.string()), windowHours: z.number() });
const kbGapPayload = z.object({
  terms: z.array(z.string()),
  resolutions: z.array(z.object({ ticketId: z.number(), ref: z.string(), title: z.string(), note: z.string() })),
});

export type ClusterPayload = z.infer<typeof clusterPayload>;
export type KbGapPayload = z.infer<typeof kbGapPayload>;
export type KbGapResolution = KbGapPayload["resolutions"][number];

export const serializeClusterPayload = (payload: ClusterPayload) => JSON.stringify(payload);
export const serializeKbGapPayload = (payload: KbGapPayload) => JSON.stringify(payload);

function parsePayload<T>(schema: z.ZodType<T>, json: string, empty: T): T {
  try {
    const parsed = schema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : empty;
  } catch {
    return empty;
  }
}

export const parseClusterPayload = (json: string) => parsePayload(clusterPayload, json, { terms: [], windowHours: 0 });
export const parseKbGapPayload = (json: string) => parsePayload(kbGapPayload, json, { terms: [], resolutions: [] });

export function clipNote(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_NOTE_CHARS ? `${oneLine.slice(0, MAX_NOTE_CHARS - 1)}…` : oneLine;
}

// ---- texts ----------------------------------------------------------------

const termList = (terms: readonly string[]) => terms.join(", ");

export function clusterInsightText(count: number, terms: readonly string[], windowHours: number) {
  const topic = terms.length > 0 ? `: ${termList(terms)}` : "";
  return {
    title: `${count} open incidents look alike${topic}`,
    summary: `${count} similar incidents were opened within ${windowHours} hours and none is linked to a problem yet.`,
  };
}

export function kbGapInsightText(count: number, terms: readonly string[], windowDays: number) {
  const topic = terms.length > 0 ? `: ${termList(terms)}` : "";
  return {
    title: `${count} resolved tickets share a fix${topic}`,
    summary: `${count} tickets resolved in the last ${windowDays} days were fixed the same way, and no knowledge article is linked to them.`,
  };
}

const clipTitle = (title: string) => (title.length > MAX_TITLE_CHARS ? `${title.slice(0, MAX_TITLE_CHARS - 1)}…` : title);

// ---- problem from a cluster -------------------------------------------------

export type ClusterTicket = {
  id: number;
  prefix: string;
  title: string;
  priority: string;
  impact: string;
  categoryId: string | null;
  groupId: string | null;
};

const highest = (values: readonly string[], order: readonly string[]) =>
  values.reduce((best, value) => (order.indexOf(value) > order.indexOf(best) ? value : best), order[0]);

function mostCommon(values: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) [best, bestCount] = [value, count];
  }
  return best;
}

/** The problem record to open for a cluster; the first ticket (lowest id) names it. */
export function problemFromCluster(tickets: readonly ClusterTicket[]) {
  const [first] = [...tickets].sort((a, b) => a.id - b.id);
  const lines = tickets.map((t) => `- ${ticketRef(t.id, t.prefix)}: ${t.title}`);
  return {
    title: clipTitle(`Recurring: ${first.title}`),
    description: `Raised from a cluster of ${tickets.length} similar incidents:\n${lines.join("\n")}`,
    priority: highest(tickets.map((t) => t.priority), PRIORITIES),
    impact: highest(tickets.map((t) => t.impact), IMPACT_URGENCY),
    categoryId: mostCommon(tickets.map((t) => t.categoryId)),
    groupId: mostCommon(tickets.map((t) => t.groupId)),
  };
}

// ---- article from a knowledge gap -------------------------------------------

export function articleTitleFromGap(resolutions: readonly KbGapResolution[]): string {
  const [first] = [...resolutions].sort((a, b) => a.ticketId - b.ticketId);
  return clipTitle(`How to resolve: ${first?.title ?? "recurring issue"}`);
}

/** Markdown outline listing the resolutions verbatim — used when AI is off or fails. */
export function articleSkeletonMarkdown(resolutions: readonly KbGapResolution[]): string {
  const symptoms = resolutions.map((r) => `- ${r.title} (${r.ref})`);
  const fixes = resolutions.map((r) => `- ${r.note} (${r.ref})`);
  return [
    "## Symptoms",
    ...symptoms,
    "",
    "## Resolution",
    ...fixes,
    "",
    "## Notes",
    `Draft assembled from ${resolutions.length} resolved tickets. Review, merge the steps and edit before publishing.`,
  ].join("\n");
}
