/**
 * Sable insight detection: scans tickets for incident clusters and knowledge
 * gaps and records each finding once as an AiInsight. Fully local (lexical
 * similarity, lib/ai-similarity.ts) — no AI provider is involved.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getNumberSetting } from "@/lib/settings";
import { OPEN_TICKET_STATUSES, ticketRef } from "@/lib/constants";
import { clusterBySimilarity, type SimilarityCluster } from "@/lib/ai-similarity";
import {
  INSIGHT_DEFAULTS, clipNote, clusterDedupeKey, clusterInsightText, isMostlyCovered, kbGapDedupeKey,
  kbGapInsightText, normalizeInsightConfig, serializeClusterPayload, serializeKbGapPayload, type InsightConfig,
  type KbGapResolution,
} from "@/lib/ai-insights-rules";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Bounds the pairwise comparison (quadratic) and the `in` lists sent to the database. */
const MAX_CANDIDATES = 400;
/** Resolution notes shorter than this carry no fix worth documenting. */
const MIN_RESOLUTION_CHARS = 15;
const SOLVED_STATUSES = ["RESOLVED", "CLOSED"];
const DOCUMENTABLE_RESOLUTION_CODES = ["FIXED", "WORKAROUND"];

type InsightKind = "CLUSTER" | "KB_GAP";

type InsightDraft = {
  dedupeKey: string;
  title: string;
  summary: string;
  payload: string;
  ticketIds: number[];
};

export async function loadInsightConfig(): Promise<InsightConfig> {
  const [clusterMinTickets, clusterWindowHours, similarityThreshold, kbGapMinTickets, kbGapWindowDays] = await Promise.all([
    getNumberSetting("INSIGHT_CLUSTER_MIN_TICKETS", INSIGHT_DEFAULTS.clusterMinTickets),
    getNumberSetting("INSIGHT_CLUSTER_WINDOW_HOURS", INSIGHT_DEFAULTS.clusterWindowHours),
    getNumberSetting("INSIGHT_SIMILARITY_THRESHOLD", INSIGHT_DEFAULTS.similarityThreshold),
    getNumberSetting("INSIGHT_KB_GAP_MIN_TICKETS", INSIGHT_DEFAULTS.kbGapMinTickets),
    getNumberSetting("INSIGHT_KB_GAP_WINDOW_DAYS", INSIGHT_DEFAULTS.kbGapWindowDays),
  ]);
  return normalizeInsightConfig({
    clusterMinTickets, clusterWindowHours, similarityThreshold, kbGapMinTickets, kbGapWindowDays,
  });
}

/** Open incidents of the window that no problem tracks yet, grouped by similarity. */
async function findClusterDrafts(config: InsightConfig, now: Date): Promise<InsightDraft[]> {
  const since = new Date(now.getTime() - config.clusterWindowHours * HOUR_MS);
  const tickets = await db.ticket.findMany({
    where: {
      type: "INCIDENT",
      status: { in: [...OPEN_TICKET_STATUSES] },
      mergedIntoId: null,
      problemId: null,
      createdAt: { gte: since },
    },
    select: { id: true, title: true, description: true, categoryId: true, serviceId: true },
    orderBy: { createdAt: "desc" },
    take: MAX_CANDIDATES,
  });
  const docs = tickets.map((t) => ({
    id: t.id, focus: t.title, context: t.description, categoryId: t.categoryId, serviceId: t.serviceId,
  }));
  return clusterBySimilarity(docs, { threshold: config.similarityThreshold, minSize: config.clusterMinTickets }).map(
    (cluster) => clusterDraft(cluster, config.clusterWindowHours),
  );
}

function clusterDraft(cluster: SimilarityCluster, windowHours: number): InsightDraft {
  const { title, summary } = clusterInsightText(cluster.ticketIds.length, cluster.sharedTerms, windowHours);
  return {
    dedupeKey: clusterDedupeKey(cluster.seedId),
    title,
    summary,
    payload: serializeClusterPayload({ terms: cluster.sharedTerms, windowHours }),
    ticketIds: cluster.ticketIds,
  };
}

/** Tickets solved the same way in the window that no knowledge article is attached to. */
async function findKbGapDrafts(config: InsightConfig, now: Date): Promise<InsightDraft[]> {
  const since = new Date(now.getTime() - config.kbGapWindowDays * DAY_MS);
  const solved = await db.ticket.findMany({
    where: {
      status: { in: SOLVED_STATUSES },
      resolvedAt: { gte: since },
      resolutionCode: { in: DOCUMENTABLE_RESOLUTION_CODES },
      resolutionNote: { not: null },
      mergedIntoId: null,
    },
    select: {
      id: true, prefix: true, title: true, resolutionNote: true, categoryId: true, serviceId: true,
    },
    orderBy: { resolvedAt: "desc" },
    take: MAX_CANDIDATES,
  });
  const withNotes = solved.filter((t) => (t.resolutionNote ?? "").trim().length >= MIN_RESOLUTION_CHARS);
  const linked = await db.articleLink.findMany({
    where: { entityType: "TICKET", entityId: { in: withNotes.map((t) => t.id) } },
    select: { entityId: true },
  });
  const documented = new Set(linked.map((l) => l.entityId));
  const undocumented = withNotes.filter((t) => !documented.has(t.id));

  const byId = new Map(undocumented.map((t) => [t.id, t]));
  const docs = undocumented.map((t) => ({
    id: t.id, focus: t.resolutionNote ?? "", context: t.title, categoryId: t.categoryId, serviceId: t.serviceId,
  }));
  return clusterBySimilarity(docs, { threshold: config.similarityThreshold, minSize: config.kbGapMinTickets }).map(
    (cluster) => {
      const resolutions: KbGapResolution[] = cluster.ticketIds.flatMap((id) => {
        const t = byId.get(id);
        return t ? [{ ticketId: id, ref: ticketRef(id, t.prefix), title: t.title, note: clipNote(t.resolutionNote ?? "") }] : [];
      });
      const { title, summary } = kbGapInsightText(cluster.ticketIds.length, cluster.sharedTerms, config.kbGapWindowDays);
      return {
        dedupeKey: kbGapDedupeKey(cluster.seedId),
        title,
        summary,
        payload: serializeKbGapPayload({ terms: cluster.sharedTerms, resolutions }),
        ticketIds: cluster.ticketIds,
      };
    },
  );
}

const prismaCode = (error: unknown) => (error as { code?: string } | null)?.code;
const isUniqueViolation = (error: unknown) => prismaCode(error) === "P2002";
/** A ticket the draft links to was deleted or merged away since the scan (connect found no row). */
const isMissingRecord = (error: unknown) => prismaCode(error) === "P2025";

/**
 * Stores the drafts that are new. A draft is skipped when most of its tickets
 * already belong to an insight of this kind, or when its dedupe key exists
 * (a concurrent run won the unique constraint) or when one of its tickets vanished
 * since the scan; the other drafts are unaffected. Returns how many were stored.
 */
async function saveNewInsights(kind: InsightKind, drafts: InsightDraft[]): Promise<number> {
  if (drafts.length === 0) return 0;
  const candidateIds = drafts.flatMap((d) => d.ticketIds);
  const coveredRows = await db.aiInsightTicket.findMany({
    where: { ticketId: { in: candidateIds }, insight: { kind } },
    select: { ticketId: true },
  });
  const covered = new Set(coveredRows.map((row) => row.ticketId));

  let saved = 0;
  for (const draft of drafts) {
    if (isMostlyCovered(draft.ticketIds, covered)) continue;
    const data: Prisma.AiInsightCreateInput = {
      kind,
      dedupeKey: draft.dedupeKey,
      title: draft.title,
      summary: draft.summary,
      payload: draft.payload,
      tickets: { create: draft.ticketIds.map((ticketId) => ({ ticket: { connect: { id: ticketId } } })) },
    };
    try {
      await db.aiInsight.create({ data });
      saved += 1;
    } catch (error) {
      if (!isUniqueViolation(error) && !isMissingRecord(error)) throw error;
    }
  }
  return saved;
}

/** One detection pass. Returns how many new insights of each kind were raised. */
export async function detectInsights(now = new Date()): Promise<{ clusters: number; kbGaps: number }> {
  const config = await loadInsightConfig();
  const clusters = await saveNewInsights("CLUSTER", await findClusterDrafts(config, now));
  const kbGaps = await saveNewInsights("KB_GAP", await findKbGapDrafts(config, now));
  return { clusters, kbGaps };
}
