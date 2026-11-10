import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { getConnector } from "@/lib/connectors";
import type { SyncSource } from "@prisma/client";
import type { SyncResult } from "@/lib/connectors/types";

// Per-source in-process lock so a manual run and a scheduled tick (or two ticks)
// can't run the same source concurrently. Survives HMR via globalThis.
const g = globalThis as unknown as { __servioSyncRunning?: Set<string> };
const running: Set<string> = (g.__servioSyncRunning ??= new Set<string>());

/**
 * Execute one sync run and persist the outcome. Session-less on purpose so both
 * the `runSync` server action (MANUAL, with the acting user) and the scheduler
 * (SCHEDULE, actorId=null) can call it. Never throws — a connector error is
 * recorded as a FAILED run. Skips (no run row) if the source is already running.
 * Does NOT revalidate paths; the action wrapper does that (revalidatePath is
 * request-scoped and unavailable in the scheduler).
 */
export async function executeSyncRun(
  source: SyncSource,
  opts: { trigger: "MANUAL" | "SCHEDULE" | "API"; actorId?: string | null },
): Promise<SyncResult> {
  if (running.has(source.id))
    return {
      status: "PARTIAL",
      created: 0,
      updated: 0,
      failed: 0,
      log: "Skipped: a run for this source is already in progress.",
    };
  running.add(source.id);
  try {
    return await runOnce(source, opts);
  } finally {
    running.delete(source.id);
  }
}

async function runOnce(
  source: SyncSource,
  opts: { trigger: "MANUAL" | "SCHEDULE" | "API"; actorId?: string | null },
): Promise<SyncResult> {
  const run = await db.syncRun.create({
    data: { sourceId: source.id, status: "RUNNING", trigger: opts.trigger },
  });

  const connector = getConnector(source.type);

  if (!connector) {
    const log = `No connector implemented for type "${source.type}" yet.`;
    const finishedAt = new Date();
    await db.syncRun.update({
      where: { id: run.id },
      data: { status: "PARTIAL", finishedAt, log },
    });
    await db.syncSource.update({
      where: { id: source.id },
      data: { lastRunAt: finishedAt, lastStatus: "PARTIAL" },
    });
    return { status: "PARTIAL", created: 0, updated: 0, failed: 0, log };
  }

  let result: SyncResult;
  try {
    result = await connector.run(source, {
      trigger: opts.trigger === "MANUAL" ? "MANUAL" : "SCHEDULED",
      actorId: opts.actorId ?? null,
    });
  } catch (e) {
    result = {
      status: "FAILED",
      created: 0,
      updated: 0,
      failed: 1,
      log: `Unexpected error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const finishedAt = new Date();
  await db.syncRun.update({
    where: { id: run.id },
    data: {
      status: result.status,
      created: result.created,
      updated: result.updated,
      failed: result.failed,
      finishedAt,
      log: result.log,
    },
  });
  await db.syncSource.update({
    where: { id: source.id },
    data: { lastRunAt: finishedAt, lastStatus: result.status },
  });

  await writeAudit({
    userId: opts.actorId ?? null,
    action: "SYNC",
    entity: "SyncSource",
    entityId: source.id,
    summary: `${opts.trigger === "SCHEDULE" ? "Scheduled sync" : "Ran sync"} "${source.name}" — ${result.created} created, ${result.updated} updated, ${result.failed} failed (${result.status})`,
  });

  return result;
}
