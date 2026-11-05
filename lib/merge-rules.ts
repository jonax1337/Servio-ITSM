/**
 * Ticket merge / unmerge rules. Pure so the actions and the tests share them;
 * the actions load the data and ask these what to carry over, what to refuse and
 * what to restore. Statuses are the String-backed values from lib/constants.ts.
 */

import { resumeData } from "@/lib/sla";
import { HIERARCHY_REFUSALS, MAX_HIERARCHY_DEPTH } from "@/lib/ticket-hierarchy-rules";

const CANCELLED = "CANCELLED";

export const MERGE_REFUSALS = {
  sourceMerged: "This ticket is already merged into another ticket.",
  sourceCancelled: "A cancelled ticket can't be merged.",
  targetUnavailable: "You can't merge into a cancelled or merged ticket.",
  targetBelowSource: "The target is a child of this ticket. Detach it first or pick another ticket.",
  noActiveMerge: "There is no merge to undo for this ticket. Merges made before undo existed can't be reverted.",
  targetMergedAgain: "The ticket it was merged into has itself been merged since. Undo that merge first.",
  mergedElsewhere: "This ticket is no longer merged into the ticket recorded for the merge.",
  mergedTicketStatus: "This ticket was merged into another ticket. Undo the merge instead of changing its status.",
  changedMeanwhile: "This ticket was changed or merged by someone else in the meantime. Reload and try again.",
  alreadyUndone: "This merge has already been undone.",
} as const;

export type MergeSource = { mergedIntoId: number | null; status: string };
export type MergeTarget = { id: number; mergedIntoId: number | null; status: string };

/**
 * Why `sourceId` may not be merged into `target`, or null when it may. Also run on the
 * target as it is inside the merge transaction, so a concurrent opposite merge is caught.
 * `targetAncestorIds` is the target followed by its ancestors: merging a ticket
 * into one of its own descendants would hang the source's children under themselves.
 */
export function mergeTargetRefusal(
  sourceId: number,
  target: Pick<MergeTarget, "mergedIntoId" | "status">,
  targetAncestorIds: readonly number[],
): string | null {
  if (target.status === CANCELLED || target.mergedIntoId !== null) return MERGE_REFUSALS.targetUnavailable;
  if (targetAncestorIds.includes(sourceId)) return MERGE_REFUSALS.targetBelowSource;
  return null;
}

/** Why `source` may not be merged into `target`, or null when it may. */
export function mergeRefusal(
  sourceId: number,
  source: MergeSource,
  target: MergeTarget,
  targetAncestorIds: readonly number[],
): string | null {
  if (source.mergedIntoId !== null) return MERGE_REFUSALS.sourceMerged;
  if (source.status === CANCELLED) return MERGE_REFUSALS.sourceCancelled;
  return mergeTargetRefusal(sourceId, target, targetAncestorIds);
}

/**
 * Why the source's children may not follow it under the target, or null when they may.
 * `targetChainLength` is the target plus its ancestors; `sourceSubtreeHeight` is how many
 * levels of descendants hang below the source (0 without children). Same limit as every
 * other attach path (parentLinkRefusal), applied to the deepest child.
 */
export function mergeDepthRefusal(targetChainLength: number, sourceSubtreeHeight: number): string | null {
  if (sourceSubtreeHeight === 0) return null;
  return targetChainLength + sourceSubtreeHeight - 1 >= MAX_HIERARCHY_DEPTH ? HIERARCHY_REFUSALS.tooDeep : null;
}

/** What the undo needs to know to decide whether it may run. */
export type UnmergeState = {
  activeMerge: { targetId: number } | null;
  sourceMergedIntoId: number | null;
  targetMergedIntoId: number | null;
};

/** Why a merge may not be undone, or null when it may. */
export function unmergeRefusal({ activeMerge, sourceMergedIntoId, targetMergedIntoId }: UnmergeState): string | null {
  if (!activeMerge) return MERGE_REFUSALS.noActiveMerge;
  if (sourceMergedIntoId !== activeMerge.targetId) return MERGE_REFUSALS.mergedElsewhere;
  if (targetMergedIntoId !== null) return MERGE_REFUSALS.targetMergedAgain;
  return null;
}

/**
 * Who the source's requester is, when the target belongs to someone else: null for the
 * same requester. A ticket's comments and files are visible to its requester, so what
 * crosses to another requester's ticket has to stay internal.
 */
export function foreignRequesterLabel(
  source: { requesterId: string; requester: { name: string | null; email: string } },
  targetRequesterId: string,
): string | null {
  return source.requesterId === targetRequesterId ? null : (source.requester.name ?? source.requester.email);
}

/** The copy of a source comment on the target: internal and attributed to the foreign requester when there is one. */
export function planCommentCopy(
  comment: { isInternal: boolean; body: string },
  sourceRef: string,
  foreignRequester: string | null,
): { isInternal: boolean; body: string } {
  const origin = foreignRequester === null ? sourceRef : `${sourceRef} (requester ${foreignRequester})`;
  return { isInternal: comment.isInternal || foreignRequester !== null, body: `[from ${origin}] ${comment.body}` };
}

/**
 * A merged ticket stays cancelled: moving it to any other status would leave
 * mergedIntoId dangling on a live ticket, so the merge has to be undone instead.
 */
export function mergedStatusRefusal(ticket: { mergedIntoId: number | null }, nextStatus: string): string | null {
  return ticket.mergedIntoId !== null && nextStatus !== CANCELLED ? MERGE_REFUSALS.mergedTicketStatus : null;
}

/**
 * Which re-parented children go back under the source. A child that is the source's
 * own ancestor now (the cancelled source was attached below it after the merge) stays
 * where it is: moving it back would make the source its own ancestor.
 * `sourceChain` is the source followed by its ancestors.
 */
export function planChildRestore(
  movedChildIds: readonly number[],
  sourceChain: readonly number[],
): { restore: number[]; kept: number[] } {
  const restore: number[] = [];
  const kept: number[] = [];
  for (const id of movedChildIds) (sourceChain.includes(id) ? kept : restore).push(id);
  return { restore, kept };
}

/** Statuses whose SLA clock was not running while the ticket was merged away. */
const STOPPED_CLOCK_STATUSES = ["PENDING", "ON_HOLD", "RESOLVED", "CLOSED"];

/**
 * The SLA fields to write when a merge is undone. The source's clock kept running while
 * it was merged away, so a ticket that was active before is credited the merged time
 * like a pause (resumeData from the moment of the merge). A ticket that was paused or
 * finished keeps its clock as it was.
 */
export function undoClockData(
  clock: Parameters<typeof resumeData>[0],
  previousStatus: string,
  mergedAt: Date,
  now: Date,
  calendar: Parameters<typeof resumeData>[2],
) {
  if (STOPPED_CLOCK_STATUSES.includes(previousStatus)) return {};
  return resumeData({ ...clock, pendingSince: mergedAt }, now, calendar);
}

/** The incoming values the target does not hold yet, each once, in order. */
export function missingFrom<T>(existing: Iterable<T>, incoming: readonly T[]): T[] {
  const known = new Set(existing);
  const added: T[] = [];
  for (const value of incoming) {
    if (known.has(value)) continue;
    known.add(value);
    added.push(value);
  }
  return added;
}

/** The id of a link/problem/change the target adopts from the source: only when the target has none. */
export function adoptedId(targetValue: number | null, sourceValue: number | null): number | null {
  return targetValue === null ? sourceValue : null;
}

export type LinkEnds = { ticketId: number; linkedTicketId: number; type: string };

const pairKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * The links to create on the target for a merge: every link of the source
 * re-created on the target (same direction and type), skipping self-links and
 * pairs the target already has in either direction, plus a DUPLICATE link
 * target -> source unless the two are already linked. `targetLinks` are the links
 * touching the target; `sourceLinks` those touching the source.
 */
export function planMergeLinks(
  sourceId: number,
  targetId: number,
  sourceLinks: readonly LinkEnds[],
  targetLinks: readonly LinkEnds[],
): LinkEnds[] {
  const taken = new Set(targetLinks.map((l) => pairKey(l.ticketId, l.linkedTicketId)));
  const planned: LinkEnds[] = [];
  for (const link of sourceLinks) {
    const sourceIsFrom = link.ticketId === sourceId;
    const other = sourceIsFrom ? link.linkedTicketId : link.ticketId;
    if (other === sourceId || other === targetId) continue;
    const key = pairKey(targetId, other);
    if (taken.has(key)) continue;
    taken.add(key);
    planned.push(
      sourceIsFrom
        ? { ticketId: targetId, linkedTicketId: other, type: link.type }
        : { ticketId: other, linkedTicketId: targetId, type: link.type },
    );
  }
  if (!taken.has(pairKey(targetId, sourceId))) {
    planned.push({ ticketId: targetId, linkedTicketId: sourceId, type: "DUPLICATE" });
  }
  return planned;
}

// ── What a merge recorded, read back for the undo ────────────────────────────

function parseList(raw: string): unknown[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export const parseStringIds = (raw: string): string[] =>
  parseList(raw).filter((v): v is string => typeof v === "string");

export const parseNumberIds = (raw: string): number[] =>
  parseList(raw).filter((v): v is number => typeof v === "number");

/** An attachment the merge re-pointed; `commentId` is the source comment it hung on (null for a ticket-level file). */
export type MovedAttachment = { id: string; commentId: string | null };

export function parseMovedAttachments(raw: string): MovedAttachment[] {
  return parseList(raw).flatMap((v) => {
    if (typeof v !== "object" || v === null) return [];
    const { id, commentId } = v as Record<string, unknown>;
    if (typeof id !== "string") return [];
    return [{ id, commentId: typeof commentId === "string" ? commentId : null }];
  });
}

export type AttachmentRestore = { id: string; ticketId: number | null; commentId: string | null };

/**
 * Where each re-pointed attachment goes back to. A file whose source comment is
 * gone returns to the ticket itself instead of failing the whole undo.
 */
export function planAttachmentRestore(
  moved: readonly MovedAttachment[],
  existingCommentIds: ReadonlySet<string>,
  sourceId: number,
): AttachmentRestore[] {
  return moved.map(({ id, commentId }) =>
    commentId !== null && existingCommentIds.has(commentId)
      ? { id, ticketId: null, commentId }
      : { id, ticketId: sourceId, commentId: null },
  );
}
