/**
 * Parent / child ticket rules. Pure so the actions, the page and the tests share
 * them; the actions load the data (ancestor chain, children) and ask these.
 */

/** Longest allowed parent chain; also stops the ancestor walk on corrupt (cyclic) data. */
export const MAX_HIERARCHY_DEPTH = 10;

/** Most recently updated tickets the parent / child pickers offer. */
export const HIERARCHY_PICKER_LIMIT = 300;

/** A parent that is finished no longer coordinates anything. */
const FINISHED_PARENT_STATUSES: readonly string[] = ["CLOSED", "CANCELLED"];

/** Statuses at which a child needs no more work, so a parent's resolution leaves it alone. */
const SETTLED_CHILD_STATUSES: readonly string[] = ["RESOLVED", "CLOSED", "CANCELLED"];

export const HIERARCHY_REFUSALS = {
  self: "A ticket can't be its own parent.",
  parentFinished: "A closed or cancelled ticket can't be a parent.",
  parentMerged: "A merged ticket can't be a parent.",
  cycle: "That would make the ticket its own ancestor.",
  tooDeep: `Ticket hierarchies can be at most ${MAX_HIERARCHY_DEPTH} levels deep.`,
} as const;

export type ParentCandidate = { status: string; mergedIntoId: number | null };

/** One parent link: `id` sits directly under `parentId`. Tickets without a parent have no edge. */
export type HierarchyEdge = { id: number; parentId: number | null };

/**
 * Why `ticketId` may not get this parent, or null when it may. `ancestorIds` is the
 * candidate parent followed by its ancestors, nearest first; `subtreeHeight` is how many
 * levels of descendants the ticket brings along (0 for a ticket without children).
 */
export function parentLinkRefusal(
  ticketId: number,
  parent: ParentCandidate,
  ancestorIds: readonly number[],
  subtreeHeight = 0,
): string | null {
  if (ancestorIds[0] === ticketId) return HIERARCHY_REFUSALS.self;
  if (FINISHED_PARENT_STATUSES.includes(parent.status)) return HIERARCHY_REFUSALS.parentFinished;
  if (parent.mergedIntoId !== null) return HIERARCHY_REFUSALS.parentMerged;
  if (ancestorIds.includes(ticketId)) return HIERARCHY_REFUSALS.cycle;
  if (ancestorIds.length + subtreeHeight >= MAX_HIERARCHY_DEPTH) return HIERARCHY_REFUSALS.tooDeep;
  return null;
}

function childrenOf(edges: readonly HierarchyEdge[]): Map<number, number[]> {
  const byParent = new Map<number, number[]>();
  for (const { id, parentId } of edges) {
    if (parentId !== null) byParent.set(parentId, [...(byParent.get(parentId) ?? []), id]);
  }
  return byParent;
}

/** `startId` followed by its ancestors, nearest first. Stops past the depth limit, so cyclic data can't loop. */
export function ancestorChain(startId: number, edges: readonly HierarchyEdge[]): number[] {
  const parents = new Map(edges.map((e) => [e.id, e.parentId]));
  const chain = [startId];
  let next = parents.get(startId) ?? null;
  while (next !== null && chain.length <= MAX_HIERARCHY_DEPTH) {
    chain.push(next);
    next = parents.get(next) ?? null;
  }
  return chain;
}

/** Every ticket below `rootId`, at any depth. */
export function descendantIds(rootId: number, edges: readonly HierarchyEdge[]): Set<number> {
  const children = childrenOf(edges);
  const found = new Set<number>();
  const queue = [rootId];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    for (const child of children.get(id) ?? []) {
      if (found.has(child)) continue;
      found.add(child);
      queue.push(child);
    }
  }
  return found;
}

/** How many levels of descendants sit below `rootId`: 0 without children, 1 with only direct children. */
export function subtreeHeight(rootId: number, edges: readonly HierarchyEdge[]): number {
  const children = childrenOf(edges);
  const seen = new Set<number>([rootId]);
  let level = [rootId];
  let height = 0;
  while (level.length > 0) {
    const next = level.flatMap((id) => children.get(id) ?? []).filter((id) => !seen.has(id));
    next.forEach((id) => seen.add(id));
    if (next.length > 0) height++;
    level = next;
  }
  return height;
}

/** The children a parent's resolution still has to take along. */
export function openChildren<T extends { status: string }>(children: readonly T[]): T[] {
  return children.filter((c) => !SETTLED_CHILD_STATUSES.includes(c.status));
}

/** A child the parent's resolution could not take along, with the workflow's reason. */
export type RefusedChild = { ref: string; error: string };

/** One line per refused child ("INC-7: reason"), for the warning that names what stayed open. */
export function refusedChildrenDetail(refused: readonly RefusedChild[]): string {
  return refused.map((c) => `${c.ref}: ${c.error}`).join("\n");
}

/** Toast suffix for a resolution that also resolved children; null when none were involved. */
export function childResolutionMessage(resolved: number, refused: number): string | null {
  const plural = (n: number) => `${n} child ticket${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (resolved > 0) parts.push(`resolved ${plural(resolved)}`);
  if (refused > 0) parts.push(`${plural(refused)} could not be resolved`);
  return parts.length ? parts.join(", ") : null;
}
