import { db } from "@/lib/db";
import { PROPAGATING_RELATION_TYPES, assetsHitBy } from "@/lib/service-graph-rules";

/**
 * CMDB impact / blast-radius traversal over the CI (configuration item) graph.
 *
 * Walks the `AssetRelation` edges breadth-first from a root asset, collecting
 * every reachable configuration item together with the depth at which it was
 * first discovered and the relation type of the edge that reached it.
 *
 * This is a read-only helper — it performs NO mutation. It is imported both by
 * the asset detail page and (in future) by the change-management feature to
 * pre-compute the affected CIs of a change.
 */

export type ImpactDirection = "downstream" | "upstream" | "both";

export interface ImpactNode {
  id: string;
  name: string;
  assetType?: string;
  status?: string;
  depth: number;
  /** Relation type of the edge that first reached this node. */
  relation?: string;
}

export interface ImpactEdge {
  sourceId: string;
  targetId: string;
  type: string;
}

export interface ImpactResult {
  root: { id: string; name: string };
  impacted: ImpactNode[];
  edges: ImpactEdge[];
}

const DEFAULT_MAX_DEPTH = 5;

export async function computeImpact(
  rootAssetId: string,
  opts?: { maxDepth?: number; direction?: ImpactDirection },
): Promise<ImpactResult> {
  const maxDepth =
    opts?.maxDepth != null && opts.maxDepth >= 0
      ? opts.maxDepth
      : DEFAULT_MAX_DEPTH;
  const direction: ImpactDirection = opts?.direction ?? "both";

  const root = await db.asset.findUnique({
    where: { id: rootAssetId },
    select: { id: true, name: true },
  });
  if (!root) {
    return { root: { id: rootAssetId, name: "Unknown" }, impacted: [], edges: [] };
  }

  const impacted: ImpactNode[] = [];
  const edges: ImpactEdge[] = [];
  const edgeSeen = new Set<string>();
  const visited = new Set<string>([root.id]);

  // BFS frontier — process one depth level at a time so `depth` is the shortest
  // hop count from the root.
  let frontier: string[] = [root.id];
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth) {
    depth += 1;

    // Load every relation touching the current frontier in a single query per
    // direction, then expand.
    const wantForward = direction === "downstream" || direction === "both";
    const wantBackward = direction === "upstream" || direction === "both";

    const [forward, backward] = await Promise.all([
      wantForward
        ? db.assetRelation.findMany({
            where: { sourceId: { in: frontier } },
            select: {
              sourceId: true,
              targetId: true,
              type: true,
              target: {
                select: { id: true, name: true, type: true, status: true },
              },
            },
          })
        : Promise.resolve([]),
      wantBackward
        ? db.assetRelation.findMany({
            where: { targetId: { in: frontier } },
            select: {
              sourceId: true,
              targetId: true,
              type: true,
              source: {
                select: { id: true, name: true, type: true, status: true },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const next = new Set<string>();

    const record = (
      edge: { sourceId: string; targetId: string; type: string },
      neighbour: { id: string; name: string; type: string; status: string },
    ) => {
      const edgeKey = `${edge.sourceId}->${edge.targetId}:${edge.type}`;
      if (!edgeSeen.has(edgeKey)) {
        edgeSeen.add(edgeKey);
        edges.push({
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          type: edge.type,
        });
      }
      if (visited.has(neighbour.id)) return;
      visited.add(neighbour.id);
      next.add(neighbour.id);
      impacted.push({
        id: neighbour.id,
        name: neighbour.name,
        assetType: neighbour.type,
        status: neighbour.status,
        depth,
        relation: edge.type,
      });
    };

    for (const r of forward) {
      record(
        { sourceId: r.sourceId, targetId: r.targetId, type: r.type },
        r.target,
      );
    }
    for (const r of backward) {
      record(
        { sourceId: r.sourceId, targetId: r.targetId, type: r.type },
        r.source,
      );
    }

    frontier = Array.from(next);
  }

  return { root: { id: root.id, name: root.name }, impacted, edges };
}

/**
 * The assets an outage of `rootAssetIds` takes down, following only the
 * relation types along which a failure travels (`ASSET_FAILURE_PROPAGATION`
 * in lib/service-graph-rules.ts: a failed target takes down what DEPENDS_ON or
 * RUNS_ON it, a failed host takes down what it HOSTS, a failed part degrades
 * what it is PART_OF). Unlike `computeImpact` this is directional by meaning,
 * not by edge orientation. Returns every reached asset with its hop count from
 * the nearest root (roots at depth 0) and the asset it was reached from; the
 * services running on them are resolved in lib/service-graph.ts.
 */
export async function failureClosure(
  rootAssetIds: readonly string[],
  opts?: { maxDepth?: number },
): Promise<Map<string, { depth: number; via: string | null }>> {
  const maxDepth = opts?.maxDepth ?? 10;
  const reached = new Map<string, { depth: number; via: string | null }>();
  for (const id of rootAssetIds) reached.set(id, { depth: 0, via: null });
  let frontier = [...reached.keys()];
  let depth = 0;
  while (frontier.length > 0 && depth < maxDepth) {
    depth += 1;
    const edges = await db.assetRelation.findMany({
      where: {
        type: { in: PROPAGATING_RELATION_TYPES },
        OR: [{ sourceId: { in: frontier } }, { targetId: { in: frontier } }],
      },
      select: { sourceId: true, targetId: true, type: true },
    });
    const hit = assetsHitBy(edges, new Set(frontier));
    frontier = [];
    for (const [assetId, via] of hit) {
      if (reached.has(assetId)) continue;
      reached.set(assetId, { depth, via });
      frontier.push(assetId);
    }
  }
  return reached;
}
