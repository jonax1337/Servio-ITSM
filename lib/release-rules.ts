/** Pure business rules for releases, shared by the server actions, the UI and their tests. */

import { isChangeLocked, statusLabel as changeStatusLabel, type PlannedWindow } from "@/lib/change-rules";
import { RELEASE_STATUS_META, releaseRef } from "@/lib/constants";

export const releaseStatusLabel = (status: string) => RELEASE_STATUS_META[status]?.label ?? status;

// ── Lifecycle ────────────────────────────────────────────────────────────────

const RELEASE_TRANSITIONS: Record<string, readonly string[]> = {
  PLANNING: ["READY", "CANCELLED"],
  READY: ["PLANNING", "IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["DEPLOYED", "CANCELLED"],
  DEPLOYED: [],
  CANCELLED: [],
};

/** Moving into these statuses needs every bundled change to have cleared approval. */
const READINESS_GATED_STATUSES: readonly string[] = ["READY", "IN_PROGRESS", "DEPLOYED"];

export function allowedReleaseTransitions(status: string): readonly string[] {
  return RELEASE_TRANSITIONS[status] ?? [];
}

/** A deployed or cancelled release is a finished record: its fields and bundle are read-only. */
export function isReleaseFinished(status: string): boolean {
  return allowedReleaseTransitions(status).length === 0;
}

/** Changes join and leave a release only while it is still being assembled. */
export function isBundleEditable(status: string): boolean {
  return status === "PLANNING";
}

export function bundleLockedMessage(status: string): string {
  return status === "READY"
    ? "This release is ready. Move it back to Planning to change its bundle."
    : `The bundle can't be changed while the release is ${releaseStatusLabel(status).toLowerCase()}.`;
}

export function releaseFinishedMessage(status: string): string {
  return `This release is ${releaseStatusLabel(status).toLowerCase()} and can no longer be edited.`;
}

// ── Readiness ────────────────────────────────────────────────────────────────

export type ReleaseMember = { id: number; status: string; plannedStart: Date | null; plannedEnd: Date | null };

export type ReleaseBlocker = { changeId: number; status: string; reason: string };

export type ReleaseReadiness = {
  /** Changes that still count (cancelled ones are ignored). */
  active: number;
  /** Active changes that have passed approval. */
  approved: number;
  blockers: ReleaseBlocker[];
  ready: boolean;
  summary: string;
};

/** Statuses a change must have left behind before its release may go ahead. */
const UNCLEARED_REASONS: Record<string, string> = {
  DRAFT: "has not been submitted for approval",
  APPROVAL: "is still waiting for CAB approval",
  REJECTED: "was rejected",
  FAILED: "failed",
};

const IGNORED_STATUS = "CANCELLED";

export function releaseReadiness(members: readonly ReleaseMember[]): ReleaseReadiness {
  const active = members.filter((m) => m.status !== IGNORED_STATUS);
  const blockers = active.flatMap((m): ReleaseBlocker[] => {
    const reason = UNCLEARED_REASONS[m.status];
    return reason ? [{ changeId: m.id, status: m.status, reason }] : [];
  });
  const approved = active.length - blockers.length;
  const ready = active.length > 0 && blockers.length === 0;
  return { active: active.length, approved, blockers, ready, summary: readinessSummary(active.length, approved, blockers.length) };
}

function readinessSummary(active: number, approved: number, blocked: number): string {
  if (active === 0) return "No changes bundled yet.";
  if (blocked === 0) return `All ${active} change${active === 1 ? " is" : "s are"} approved.`;
  return `${approved} of ${active} changes approved, ${blocked} blocking.`;
}

export function blockerMessage(blocker: ReleaseBlocker): string {
  return `${changeStatusLabel(blocker.status)}: this change ${blocker.reason}.`;
}

/** Why a release may not move to `to` right now, or null when the move is allowed. */
export function releaseTransitionError(
  from: string,
  to: string,
  members: readonly ReleaseMember[],
): string | null {
  if (!allowedReleaseTransitions(from).includes(to)) {
    return `A release cannot move from ${releaseStatusLabel(from)} to ${releaseStatusLabel(to)}.`;
  }
  if (!READINESS_GATED_STATUSES.includes(to)) return null;
  const readiness = releaseReadiness(members);
  if (readiness.active === 0) return "Bundle at least one change before the release can go ahead.";
  if (!readiness.ready) return `Not every change is approved yet: ${readiness.summary}`;
  return null;
}

export function shouldStampDeployedAt(to: string, deployedAt: Date | null): boolean {
  return to === "DEPLOYED" && !deployedAt;
}

// ── Window ───────────────────────────────────────────────────────────────────

/** The release window spans its changes' planned windows: earliest start to latest end. Cancelled changes don't count. */
export function releaseWindow(members: readonly ReleaseMember[]): PlannedWindow {
  const counted = members.filter((m) => m.status !== IGNORED_STATUS);
  const starts = counted.flatMap((m) => (m.plannedStart ? [m.plannedStart.getTime()] : []));
  const ends = counted.flatMap((m) => (m.plannedEnd ? [m.plannedEnd.getTime()] : []));
  return {
    start: starts.length ? new Date(Math.min(...starts)) : null,
    end: ends.length ? new Date(Math.max(...ends)) : null,
  };
}

// ── Bundling ─────────────────────────────────────────────────────────────────

/** Why a change cannot join `releaseId`, or null when it can. */
export function bundleError(
  change: { status: string; releaseId: number | null },
  releaseId: number,
): string | null {
  if (change.releaseId === releaseId) return "This change is already part of the release.";
  if (change.releaseId !== null) {
    return `This change already ships in ${releaseRef(change.releaseId)}. Remove it there first.`;
  }
  if (isChangeLocked(change.status)) return "A closed or cancelled change cannot join a release.";
  return null;
}

// ── Search ───────────────────────────────────────────────────────────────────

/** Ids are 32-bit integers; larger numbers cannot match and make Prisma throw. */
const MAX_RELEASE_ID = 2147483647;

/** The release id a search text refers to ("REL-0003", "rel-3", "#3" or "3"), or null for a plain name search. */
export function releaseSearchId(q: string): number | null {
  const match = q.trim().match(/^(?:REL-|#)?0*(\d+)$/i);
  const id = match ? Number(match[1]) : NaN;
  return id >= 1 && id <= MAX_RELEASE_ID ? id : null;
}
