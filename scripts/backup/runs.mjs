// The BackupRun rows a backup outside the app writes itself: a run started
// from the command line (scripts/backup/run.mjs) records itself like the app's
// runs do, so the run history, the monitoring endpoint and the one-backup-at-a-
// time lock see it; and a restore settles the row of the run that took the
// snapshot. Plain node:sqlite against the Prisma table (DateTime columns hold
// Unix milliseconds, Boolean columns 0/1).
import { randomUUID } from "node:crypto";
import { BACKUP_RUN_STALE_MS } from "./layout.mjs";
import { openWritable } from "./sqlite.mjs";

const TABLE = '"BackupRun"';

export class BackupLockedError extends Error {}

/**
 * @param {import("node:sqlite").DatabaseSync} db
 * @returns {boolean} whether the database has the BackupRun table (older versions do not)
 */
function hasRunTable(db) {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'BackupRun'").get() !== undefined;
}

/**
 * @template T
 * @param {string} dbFile
 * @param {(db: import("node:sqlite").DatabaseSync) => T} work
 * @returns {T}
 */
function withDatabase(dbFile, work) {
  const db = openWritable(dbFile);
  try {
    return work(db);
  } finally {
    db.close();
  }
}

/**
 * Claims the backup lock with a RUNNING row, like the app does. Refused while
 * another run's heartbeat is fresh; a stale RUNNING row is marked interrupted.
 *
 * @param {string} dbFile
 * @param {{ trigger: string, now?: Date }} options
 * @returns {string | null} the run id, or null when the database has no BackupRun table
 * @throws {BackupLockedError} while another backup runs
 */
export function claimRun(dbFile, { trigger, now = new Date() }) {
  return withDatabase(dbFile, (db) => {
    if (!hasRunTable(db)) return null;
    db.exec("BEGIN IMMEDIATE");
    try {
      const at = now.getTime();
      db.prepare(
        `UPDATE ${TABLE} SET "status" = 'FAILED', "finishedAt" = ?, "errorCode" = 'interrupted',
           "error" = 'Interrupted: the process running this backup stopped (restart or crash).'
         WHERE "status" = 'RUNNING' AND "heartbeatAt" < ?`,
      ).run(at, at - BACKUP_RUN_STALE_MS);
      if (db.prepare(`SELECT 1 FROM ${TABLE} WHERE "status" = 'RUNNING'`).get() !== undefined) {
        throw new BackupLockedError("A backup is already running.");
      }
      const id = randomUUID();
      db.prepare(
        `INSERT INTO ${TABLE} ("id", "status", "trigger", "startedAt", "heartbeatAt", "createdAt") VALUES (?, 'RUNNING', ?, ?, ?, ?)`,
      ).run(id, trigger, at, at, at);
      db.exec("COMMIT");
      return id;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  });
}

/**
 * @param {string} dbFile
 * @param {string} runId
 */
export function touchRun(dbFile, runId) {
  withDatabase(dbFile, (db) => {
    db.prepare(`UPDATE ${TABLE} SET "heartbeatAt" = ? WHERE "id" = ? AND "status" = 'RUNNING'`).run(Date.now(), runId);
  });
}

/**
 * @typedef {{
 *   ok: boolean,
 *   name?: string | null,
 *   database_bytes?: number | null,
 *   uploads_bytes?: number | null,
 *   uploads_files?: number | null,
 *   verification?: { problems?: string[], warnings?: string[], checks?: unknown } | null,
 *   pruned?: string[],
 *   error?: string,
 *   error_code?: string,
 * }} RunResult
 */

/**
 * Records the outcome of a claimed run and marks the runs whose backups
 * retention removed.
 *
 * @param {string} dbFile
 * @param {string} runId
 * @param {RunResult} result
 * @param {Date} [now]
 */
export function finishRun(dbFile, runId, result, now = new Date()) {
  const at = now.getTime();
  const details = {
    checks: result.verification?.checks ?? null,
    problems: result.verification?.problems ?? [],
    warnings: result.verification?.warnings ?? [],
    pruned: result.pruned ?? [],
  };
  withDatabase(dbFile, (db) => {
    db.prepare(
      `UPDATE ${TABLE} SET "status" = ?, "finishedAt" = ?, "heartbeatAt" = ?, "name" = ?, "databaseBytes" = ?, "uploadsBytes" = ?,
         "uploadsFiles" = ?, "verified" = ?, "details" = ?, "error" = ?, "errorCode" = ? WHERE "id" = ?`,
    ).run(
      result.ok ? "SUCCESS" : "FAILED",
      at,
      at,
      result.name ?? null,
      result.database_bytes ?? null,
      result.uploads_bytes ?? null,
      result.uploads_files ?? null,
      result.ok ? 1 : 0,
      JSON.stringify(details),
      result.ok ? null : (result.error ?? "Unknown error"),
      result.ok ? null : (result.error_code ?? "backup_failed"),
      runId,
    );
    const mark = db.prepare(`UPDATE ${TABLE} SET "prunedAt" = ? WHERE "name" = ? AND "prunedAt" IS NULL`);
    for (const name of details.pruned) mark.run(at, name);
  });
}

/**
 * Settles the run rows inside a database restored from a backup. The snapshot
 * was taken while its own run was RUNNING; left as it is, the app would mark
 * that run as interrupted. It is recorded as the verified backup it became;
 * any other run that was RUNNING at that moment did not finish in this
 * database's history and is marked interrupted.
 *
 * @param {string} dbFile the restored copy (not yet in place)
 * @param {{ runId: string | null, name: string, finishedAt: Date, databaseBytes: number | null, uploadsBytes: number | null, uploadsFiles: number | null }} snapshot
 * @returns {{ settled: number, interrupted: number }}
 */
export function settleRestoredRuns(dbFile, snapshot) {
  return withDatabase(dbFile, (db) => {
    if (!hasRunTable(db)) return { settled: 0, interrupted: 0 };
    const at = snapshot.finishedAt.getTime();
    const settled = snapshot.runId
      ? db
          .prepare(
            `UPDATE ${TABLE} SET "status" = 'SUCCESS', "verified" = 1, "finishedAt" = ?, "heartbeatAt" = ?, "name" = ?,
               "databaseBytes" = ?, "uploadsBytes" = ?, "uploadsFiles" = ?, "error" = NULL, "errorCode" = NULL
             WHERE "id" = ? AND "status" = 'RUNNING'`,
          )
          .run(at, at, snapshot.name, snapshot.databaseBytes, snapshot.uploadsBytes, snapshot.uploadsFiles, snapshot.runId).changes
      : 0;
    const interrupted = db
      .prepare(
        `UPDATE ${TABLE} SET "status" = 'FAILED', "finishedAt" = ?, "errorCode" = 'interrupted',
           "error" = 'Interrupted: the database was restored from a backup taken while this run was in progress.'
         WHERE "status" = 'RUNNING'`,
      )
      .run(at).changes;
    return { settled: Number(settled), interrupted: Number(interrupted) };
  });
}
