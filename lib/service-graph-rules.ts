/**
 * Pure graph rules of the service map (CMDB service mapping). DB-free so the
 * cycle check and the impact walk are unit-testable; lib/service-graph.ts loads
 * the rows and calls these.
 *
 * Direction: a `ServiceDependency` row `from → to` reads "from DEPENDS_ON to",
 * so an outage of `to` affects `from` ("to is used by from").
 */

export type ServiceEdge = { from: string; to: string };

/** One affected node of an impact walk: how many hops from the failure, and the node it was reached from. */
export type ImpactHit = { depth: number; via: string | null };

function adjacency(edges: readonly ServiceEdge[], key: "from" | "to") {
  const other = key === "from" ? "to" : "from";
  const map = new Map<string, string[]>();
  for (const e of edges) {
    const list = map.get(e[key]);
    if (list) list.push(e[other]);
    else map.set(e[key], [e[other]]);
  }
  return map;
}

/**
 * The cycle that setting `serviceId`'s dependencies to `targetIds` would close,
 * as a path of service ids that starts and ends with `serviceId`
 * (`[a, b, c, a]` = a depends on b, b on c, c on a), or null when the new set
 * keeps the graph acyclic. `serviceId`'s current outgoing edges are ignored,
 * because the new set replaces them. A self-dependency is `[a, a]`.
 */
export function dependencyCycle(edges: readonly ServiceEdge[], serviceId: string, targetIds: readonly string[]): string[] | null {
  if (targetIds.includes(serviceId)) return [serviceId, serviceId];
  const out = adjacency(edges.filter((e) => e.from !== serviceId), "from");
  // Breadth-first from every new target along "depends on": reaching serviceId closes a cycle.
  const parent = new Map<string, string>();
  const queue: string[] = [];
  for (const t of targetIds) {
    if (parent.has(t)) continue;
    parent.set(t, serviceId);
    queue.push(t);
  }
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const next of out.get(node) ?? []) {
      if (next === serviceId) {
        const path = [serviceId, node];
        let cur = node;
        while (parent.get(cur) !== serviceId) {
          cur = parent.get(cur)!;
          path.splice(1, 0, cur);
        }
        path.push(serviceId);
        return path;
      }
      if (parent.has(next)) continue;
      parent.set(next, node);
      queue.push(next);
    }
  }
  return null;
}

/**
 * Breadth-first closure from `roots` along the given direction, excluding the
 * roots themselves. `"dependents"` follows "used by" (who is hit when a root
 * fails); `"dependencies"` follows "depends on" (what a root needs).
 */
export function serviceClosure(
  edges: readonly ServiceEdge[],
  roots: readonly string[],
  direction: "dependents" | "dependencies",
): Map<string, ImpactHit> {
  const next = adjacency(edges, direction === "dependents" ? "to" : "from");
  const rootSet = new Set(roots);
  const hits = new Map<string, ImpactHit>();
  let frontier = [...rootSet];
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const level: string[] = [];
    for (const node of frontier) {
      for (const n of next.get(node) ?? []) {
        if (rootSet.has(n) || hits.has(n)) continue;
        hits.set(n, { depth, via: node });
        level.push(n);
      }
    }
    frontier = level;
  }
  return hits;
}

// ── Asset failure propagation ────────────────────────────────────────────────

/**
 * Which end of an asset relation `source —type→ target` goes down when the
 * other end fails:
 * - `DEPENDS_ON` / `RUNS_ON`: the source needs the target → a failed target takes the source down.
 * - `HOSTS`: the source carries the target → a failed source takes the target down.
 * - `PART_OF`: the source is a component of the target → a failed part degrades the whole.
 * - `CONNECTS_TO` / `BACKS_UP`: no outage propagates.
 */
export const ASSET_FAILURE_PROPAGATION: Record<string, "source" | "target" | null> = {
  DEPENDS_ON: "source",
  RUNS_ON: "source",
  HOSTS: "target",
  PART_OF: "target",
  CONNECTS_TO: null,
  BACKS_UP: null,
};

export type AssetEdge = { sourceId: string; targetId: string; type: string };

/** The relation types along which a failure travels, for the DB query that loads a level. */
export const PROPAGATING_RELATION_TYPES = Object.entries(ASSET_FAILURE_PROPAGATION)
  .filter(([, v]) => v !== null)
  .map(([k]) => k);

/**
 * The assets that one level of edges takes down when `failed` are down: for
 * each edge touching a failed asset, the end the propagation rule names, if it
 * is not the failed end itself.
 */
export function assetsHitBy(edges: readonly AssetEdge[], failed: ReadonlySet<string>): Map<string, string> {
  const hit = new Map<string, string>();
  for (const e of edges) {
    const affected = ASSET_FAILURE_PROPAGATION[e.type];
    if (affected === "source" && failed.has(e.targetId) && !failed.has(e.sourceId)) {
      if (!hit.has(e.sourceId)) hit.set(e.sourceId, e.targetId);
    } else if (affected === "target" && failed.has(e.sourceId) && !failed.has(e.targetId)) {
      if (!hit.has(e.targetId)) hit.set(e.targetId, e.sourceId);
    }
  }
  return hit;
}

/** A service affected by a failure, as the impact views list it. */
export type AffectedService = {
  serviceId: string;
  /** 0 = runs on a failed asset (or is the failed service); more = via that many service dependencies. */
  depth: number;
  /** True when the service runs directly on one of the assets in question. */
  direct: boolean;
  /** The service (or asset, at depth 0) it was reached from. */
  via: string | null;
};

/**
 * The services an outage hits: those running on any of `failedAssetIds`
 * (depth 0, `direct`), then everything that depends on them, transitively.
 * `failedServiceIds` are treated as down themselves and left out of the result
 * (the "what if this service fails" view).
 */
export function affectedServices(input: {
  serviceAssets: readonly { serviceId: string; assetId: string }[];
  edges: readonly ServiceEdge[];
  failedAssetIds?: readonly string[];
  failedServiceIds?: readonly string[];
  /**
   * The assets the question is about, when `failedAssetIds` also holds assets
   * they take down (lib/cmdb-graph.ts `failureClosure`): only a service running
   * on one of these counts as `direct`. Defaults to every failed asset.
   */
  rootAssetIds?: readonly string[];
}): AffectedService[] {
  const failedAssets = new Set(input.failedAssetIds ?? []);
  const failedServices = new Set(input.failedServiceIds ?? []);
  const roots = new Set(input.rootAssetIds ?? input.failedAssetIds ?? []);
  const onFailed = new Map<string, { assetId: string; direct: boolean }>();
  for (const sa of input.serviceAssets) {
    if (!failedAssets.has(sa.assetId) || failedServices.has(sa.serviceId)) continue;
    const seen = onFailed.get(sa.serviceId);
    if (!seen || (!seen.direct && roots.has(sa.assetId))) onFailed.set(sa.serviceId, { assetId: sa.assetId, direct: roots.has(sa.assetId) });
  }
  const result: AffectedService[] = [...onFailed].map(([serviceId, hit]) => ({ serviceId, depth: 0, direct: hit.direct, via: hit.assetId }));
  const closure = serviceClosure(input.edges, [...onFailed.keys(), ...failedServices], "dependents");
  for (const [serviceId, hit] of closure) {
    if (failedServices.has(serviceId)) continue;
    result.push({ serviceId, depth: hit.depth, direct: false, via: hit.via });
  }
  return result.sort((a, b) => a.depth - b.depth);
}

// ── Link-set planning (shared by the API, the upsert and the console) ────────

export type DependencyWant = { toServiceId: string; note: string | null };

/**
 * What it takes to turn the current dependency set into `want`: rows to add,
 * rows to drop and rows whose note changes. Re-sending the current set plans
 * nothing, which is what makes the upsert idempotent.
 */
export function planDependencies(current: readonly DependencyWant[], want: readonly DependencyWant[]) {
  const now = new Map(current.map((d) => [d.toServiceId, d.note ?? null]));
  const next = new Map(want.map((d) => [d.toServiceId, d.note ?? null]));
  const add = want.filter((d) => !now.has(d.toServiceId));
  const remove = current.filter((d) => !next.has(d.toServiceId)).map((d) => d.toServiceId);
  const renote = want.filter((d) => now.has(d.toServiceId) && now.get(d.toServiceId) !== (d.note ?? null));
  return { add, remove, renote, changed: add.length + remove.length + renote.length > 0 };
}

/** Assets to link and unlink to turn `current` into `want` (a set: order and duplicates do not matter). */
export function planAssetSet(current: readonly string[], want: readonly string[]) {
  const now = new Set(current);
  const next = new Set(want);
  const add = [...next].filter((id) => !now.has(id));
  const remove = [...now].filter((id) => !next.has(id));
  return { add, remove, changed: add.length + remove.length > 0 };
}
