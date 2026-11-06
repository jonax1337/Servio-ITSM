import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import type { ActionResult } from "@/lib/action-result";
import { releaseRef } from "@/lib/constants";
import {
  bundleError,
  bundleLockedMessage,
  isBundleEditable,
  isReleaseFinished,
  releaseFinishedMessage,
  releaseTransitionError,
  releaseStatusLabel,
  shouldStampDeployedAt,
} from "@/lib/release-rules";

/**
 * Release mutations. Callers (the server actions in lib/actions/releases.ts and the Sable
 * operations) have already checked that the acting user may work on releases (AGENT+); this
 * module owns every other rule, so both entry points behave the same.
 */

const MIN_NAME_LENGTH = 3;
const MAX_NAME_LENGTH = 120;
const AGENT_ROLES = ["ADMIN", "MANAGER", "AGENT"];

export type ReleaseInput = {
  name: string;
  description: string | null;
  ownerId: string | null;
  groupId: string | null;
};

export type CreateReleaseResult = { ok: true; id: number } | { ok: false; error: string };

const OK: ActionResult = { ok: true };
const refuse = (error: string): { ok: false; error: string } => ({ ok: false, error });
const STALE_RELEASE_MESSAGE = "The release was updated by someone else. Reload and try again.";

function revalidateRelease(id: number) {
  revalidatePath("/releases");
  revalidatePath(`/releases/${id}`);
}

/** Why the release fields are unusable, or null. Owner and group must exist; the owner must be an active agent. */
async function inputError(input: ReleaseInput): Promise<string | null> {
  const name = input.name.trim();
  if (name.length < MIN_NAME_LENGTH) return `The release name must be at least ${MIN_NAME_LENGTH} characters.`;
  if (name.length > MAX_NAME_LENGTH) return `The release name must be at most ${MAX_NAME_LENGTH} characters.`;
  if (input.ownerId) {
    const owner = await db.user.findFirst({
      where: { id: input.ownerId, isActive: true, role: { in: AGENT_ROLES } },
      select: { id: true },
    });
    if (!owner) return "The owner must be an active agent.";
  }
  if (input.groupId) {
    const group = await db.group.findUnique({ where: { id: input.groupId }, select: { id: true } });
    if (!group) return "Group not found.";
  }
  return null;
}

const toData = (input: ReleaseInput) => ({
  name: input.name.trim(),
  description: input.description?.trim() || null,
  ownerId: input.ownerId,
  groupId: input.groupId,
});

export async function createRelease(actorId: string, input: ReleaseInput): Promise<CreateReleaseResult> {
  const problem = await inputError(input);
  if (problem) return refuse(problem);
  const release = await db.release.create({ data: toData(input), select: { id: true, name: true } });
  await writeAudit({
    userId: actorId,
    action: "CREATE",
    entity: "Release",
    entityId: release.id,
    summary: `Created release ${releaseRef(release.id)} "${release.name}"`,
  });
  revalidateRelease(release.id);
  return { ok: true, id: release.id };
}

export async function updateRelease(actorId: string, id: number, input: ReleaseInput): Promise<ActionResult> {
  const current = await db.release.findUnique({ where: { id }, select: { status: true } });
  if (!current) return refuse("Release not found.");
  if (isReleaseFinished(current.status)) return refuse(releaseFinishedMessage(current.status));
  const problem = await inputError(input);
  if (problem) return refuse(problem);
  const updated = await db.release.updateMany({ where: { id, status: current.status }, data: toData(input) });
  if (updated.count === 0) return refuse(STALE_RELEASE_MESSAGE);
  await writeAudit({ userId: actorId, action: "UPDATE", entity: "Release", entityId: id, summary: `Edited release ${releaseRef(id)}` });
  revalidateRelease(id);
  return OK;
}

export async function moveRelease(actorId: string, id: number, to: string): Promise<ActionResult> {
  const release = await db.release.findUnique({
    where: { id },
    select: {
      status: true,
      deployedAt: true,
      changes: { select: { id: true, status: true, plannedStart: true, plannedEnd: true } },
    },
  });
  if (!release) return refuse("Release not found.");
  const error = releaseTransitionError(release.status, to, release.changes);
  if (error) return refuse(error);

  const stamp = shouldStampDeployedAt(to, release.deployedAt) ? { deployedAt: new Date() } : {};
  // Guard on the status we validated against, so a concurrent move is not overwritten.
  const freed = await db.$transaction(async (tx) => {
    const moved = await tx.release.updateMany({ where: { id, status: release.status }, data: { status: to, ...stamp } });
    if (moved.count === 0) return null;
    // A cancelled release lets go of its changes so they can ship elsewhere.
    if (to !== "CANCELLED") return 0;
    return (await tx.change.updateMany({ where: { releaseId: id }, data: { releaseId: null } })).count;
  });
  if (freed === null) return refuse(STALE_RELEASE_MESSAGE);

  const freedNote = freed > 0 ? ` (${freed} change${freed === 1 ? "" : "s"} released from the bundle)` : "";
  await writeAudit({
    userId: actorId,
    action: "UPDATE",
    entity: "Release",
    entityId: id,
    summary: `Moved ${releaseRef(id)} to ${releaseStatusLabel(to)}${freedNote}`,
  });
  revalidateRelease(id);
  if (freed > 0) revalidatePath("/changes");
  return OK;
}

export async function addChangeToRelease(actorId: string, releaseId: number, changeId: number): Promise<ActionResult> {
  const [release, change] = await Promise.all([
    db.release.findUnique({ where: { id: releaseId }, select: { status: true } }),
    db.change.findUnique({ where: { id: changeId }, select: { status: true, releaseId: true } }),
  ]);
  if (!release) return refuse("Release not found.");
  if (!change) return refuse("Change not found.");
  if (!isBundleEditable(release.status)) return refuse(bundleLockedMessage(release.status));
  const problem = bundleError(change, releaseId);
  if (problem) return refuse(problem);

  // releaseId: null in the guard makes the join atomic against a concurrent bundling elsewhere.
  const joined = await db.change.updateMany({
    where: { id: changeId, releaseId: null, status: change.status },
    data: { releaseId },
  });
  if (joined.count === 0) return refuse("The change was updated by someone else. Reload and try again.");
  await writeAudit({ userId: actorId, action: "UPDATE", entity: "Release", entityId: releaseId, summary: `Added change #${changeId} to ${releaseRef(releaseId)}` });
  await writeAudit({ userId: actorId, action: "UPDATE", entity: "Change", entityId: changeId, summary: `Added to release ${releaseRef(releaseId)}` });
  revalidateRelease(releaseId);
  revalidatePath(`/changes/${changeId}`);
  return OK;
}

export async function removeChangeFromRelease(actorId: string, releaseId: number, changeId: number): Promise<ActionResult> {
  const release = await db.release.findUnique({ where: { id: releaseId }, select: { status: true } });
  if (!release) return refuse("Release not found.");
  if (!isBundleEditable(release.status)) return refuse(bundleLockedMessage(release.status));

  const removed = await db.change.updateMany({ where: { id: changeId, releaseId }, data: { releaseId: null } });
  if (removed.count === 0) return refuse("This change is not part of the release.");
  await writeAudit({ userId: actorId, action: "UPDATE", entity: "Release", entityId: releaseId, summary: `Removed change #${changeId} from ${releaseRef(releaseId)}` });
  await writeAudit({ userId: actorId, action: "UPDATE", entity: "Change", entityId: changeId, summary: `Removed from release ${releaseRef(releaseId)}` });
  revalidateRelease(releaseId);
  revalidatePath(`/changes/${changeId}`);
  return OK;
}
