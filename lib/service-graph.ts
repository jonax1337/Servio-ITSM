import { db } from "@/lib/db";
import { failureClosure } from "@/lib/cmdb-graph";
import { affectedServices, type AffectedService, type ServiceEdge } from "@/lib/service-graph-rules";

/**
 * Read side of the service map: who depends on whom and which services an
 * outage hits. The graph rules themselves are pure (lib/service-graph-rules.ts);
 * this module loads the rows. Read-only.
 */

export const SERVICE_BADGE_SELECT = { id: true, name: true, code: true, status: true, criticality: true } as const;
export type ServiceBadge = { id: string; name: string; code: string | null; status: string; criticality: string };

/** An affected service with its row, as the impact views render it. */
export type ServiceImpactRow = ServiceBadge & {
  depth: number;
  direct: boolean;
  /** What it was reached from: an asset (runs on it) or a service (depends on it). */
  via: { kind: "asset" | "service"; id: string; name: string } | null;
};

/** Every dependency edge. The service portfolio is small (hundreds at most), so the walk runs in memory. */
export async function loadServiceEdges(): Promise<ServiceEdge[]> {
  const rows = await db.serviceDependency.findMany({ select: { fromServiceId: true, toServiceId: true } });
  return rows.map((r) => ({ from: r.fromServiceId, to: r.toServiceId }));
}

async function withRows(hits: AffectedService[], assetNames: Map<string, string>): Promise<ServiceImpactRow[]> {
  if (hits.length === 0) return [];
  const rows = await db.service.findMany({
    where: { id: { in: [...new Set(hits.flatMap((h) => [h.serviceId, ...(h.depth > 0 && h.via ? [h.via] : [])]))] } },
    select: SERVICE_BADGE_SELECT,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: ServiceImpactRow[] = [];
  for (const h of hits) {
    const row = byId.get(h.serviceId);
    if (!row) continue;
    let via: ServiceImpactRow["via"] = null;
    if (h.via && h.depth === 0 && assetNames.has(h.via)) via = { kind: "asset", id: h.via, name: assetNames.get(h.via)! };
    else if (h.via && byId.has(h.via)) via = { kind: "service", id: h.via, name: byId.get(h.via)!.name };
    out.push({ ...row, depth: h.depth, direct: h.direct, via });
  }
  return out.sort((a, b) => a.depth - b.depth || Number(b.direct) - Number(a.direct) || a.name.localeCompare(b.name));
}

/** The services that (transitively) depend on `serviceId`: what goes down with it. */
export async function serviceImpact(serviceId: string): Promise<ServiceImpactRow[]> {
  const edges = await loadServiceEdges();
  return withRows(affectedServices({ serviceAssets: [], edges, failedServiceIds: [serviceId] }), new Map());
}

/**
 * The services an outage of `assetIds` hits: the ones running on them
 * (`direct`), the ones running on assets they take down (asset failure
 * propagation, lib/cmdb-graph.ts `failureClosure`) and everything depending
 * on either, transitively.
 */
export async function servicesAffectedByAssets(assetIds: readonly string[]): Promise<ServiceImpactRow[]> {
  if (assetIds.length === 0) return [];
  const closure = await failureClosure(assetIds);
  const failed = [...closure.keys()];
  const [serviceAssets, edges, assets] = await Promise.all([
    db.serviceAsset.findMany({ where: { assetId: { in: failed } }, select: { serviceId: true, assetId: true } }),
    loadServiceEdges(),
    db.asset.findMany({ where: { id: { in: failed } }, select: { id: true, name: true } }),
  ]);
  if (serviceAssets.length === 0) return [];
  const hits = affectedServices({ serviceAssets, edges, failedAssetIds: failed, rootAssetIds: assetIds });
  return withRows(hits, new Map(assets.map((a) => [a.id, a.name])));
}

/** The affected services of a ticket, from the CIs linked to it. */
export async function ticketAffectedServices(ticketId: number) {
  const links = await db.ticketAsset.findMany({ where: { ticketId }, select: { assetId: true } });
  return servicesAffectedByAssets(links.map((l) => l.assetId));
}

/** The affected services of a change, from its affected CIs. */
export async function changeAffectedServices(changeId: number) {
  const links = await db.changeAsset.findMany({ where: { changeId }, select: { assetId: true } });
  return servicesAffectedByAssets(links.map((l) => l.assetId));
}

/** The affected services of a problem, from the CIs of its linked incidents and changes. */
export async function problemAffectedServices(problemId: number) {
  const [tickets, changes] = await Promise.all([
    db.ticketAsset.findMany({ where: { ticket: { problemId } }, select: { assetId: true } }),
    db.changeAsset.findMany({ where: { change: { problemId } }, select: { assetId: true } }),
  ]);
  return servicesAffectedByAssets([...new Set([...tickets, ...changes].map((l) => l.assetId))]);
}
