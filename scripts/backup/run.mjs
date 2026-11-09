#!/usr/bin/env node
// Runs one backup (create + verify + publish) and applies retention.
//
// The app starts this as a child process, so the snapshot, the archive and the
// verification never block its event loop; operators can run it by hand too:
//
//   node scripts/backup/run.mjs [--json] [--db FILE] [--uploads DIR | --no-uploads]
//                               [--backup-dir DIR] [--keep-count N] [--keep-days N]
//                               [--no-prune] [--no-record] [--app-version V]
//
// Defaults come from the environment the app uses: DATABASE_URL (SQLite file:
// URL, relative paths resolve against ./prisma like Prisma does), UPLOAD_DIR
// (./.uploads), BACKUP_DIR (./.backups), BACKUP_RETENTION_COUNT (7) and
// BACKUP_RETENTION_DAYS (14). With --json the result is one JSON line on stdout;
// progress goes to stderr. Exit code 0 = verified backup published, 1 = failed.
//
// A run started by hand records itself in the run history (trigger CLI) and
// takes the same one-backup-at-a-time lock as the app; --no-record skips that.
// The app passes --run-id (it owns that run's row) and --trigger.
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { BACKUP_ERROR_CODES, BackupError, createBackup } from "./create.mjs";
import { BACKUP_HEARTBEAT_MS, normalizeRetention, pruneBackups, sqliteFileFromUrl } from "./layout.mjs";
import { BackupLockedError, claimRun, finishRun, touchRun } from "./runs.mjs";

const TRIGGERS = ["SCHEDULE", "MANUAL", "CLI"];

const { values } = parseArgs({
  options: {
    json: { type: "boolean", default: false },
    db: { type: "string" },
    uploads: { type: "string" },
    "no-uploads": { type: "boolean", default: false },
    "backup-dir": { type: "string" },
    "keep-count": { type: "string" },
    "keep-days": { type: "string" },
    "no-prune": { type: "boolean", default: false },
    "no-record": { type: "boolean", default: false },
    "run-id": { type: "string" },
    trigger: { type: "string", default: "CLI" },
    "app-version": { type: "string" },
    help: { type: "boolean", default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  process.stdout.write(
    "Usage: node scripts/backup/run.mjs [--json] [--db FILE] [--uploads DIR | --no-uploads] [--backup-dir DIR]\n" +
      "                                   [--keep-count N] [--keep-days N] [--no-prune] [--no-record] [--app-version V]\n",
  );
  process.exit(0);
}

const log = (/** @type {string} */ line) => process.stderr.write(`[servio:backup] ${line}\n`);
const envNumber = (/** @type {string | undefined} */ raw) => (raw === undefined || raw.trim() === "" ? undefined : Number(raw));

/** @param {Record<string, unknown>} result */
function finish(result) {
  if (values.json) process.stdout.write(JSON.stringify(result) + "\n");
  else if (result.ok) log(`backup ${result.name} verified and stored in ${result.path}`);
  else log(`backup FAILED: ${result.error}`);
  process.exitCode = result.ok ? 0 : 1;
}

/**
 * Claims a run row for a backup started by hand. Null when the run is not
 * recorded (--no-record, a database without the table, or one this user
 * cannot write: the backup itself only reads it).
 *
 * @param {string} dbFile
 * @param {string} trigger
 * @returns {string | null}
 * @throws {BackupLockedError}
 */
function claimOwnRun(dbFile, trigger) {
  if (values["no-record"]) return null;
  try {
    const id = claimRun(dbFile, { trigger });
    if (!id) log("this database has no run history yet; the run is not recorded");
    return id;
  } catch (error) {
    if (error instanceof BackupLockedError) throw error;
    log(`the run cannot be recorded (${error instanceof Error ? error.message : error}); backing up anyway`);
    return null;
  }
}

/**
 * @param {string} dbFile
 * @param {string} backupDir
 * @param {string | null} uploadDir
 * @param {{ runId: string | null, trigger: string, exclusive: boolean }} run
 * @returns {Promise<Record<string, unknown>>}
 */
async function backUp(dbFile, backupDir, uploadDir, run) {
  const policy = normalizeRetention({
    keepCount: envNumber(values["keep-count"] ?? process.env.BACKUP_RETENTION_COUNT),
    keepDays: envNumber(values["keep-days"] ?? process.env.BACKUP_RETENTION_DAYS),
  });
  try {
    const backup = await createBackup({
      dbFile,
      uploadDir,
      backupDir,
      appVersion: values["app-version"] ?? null,
      trigger: run.trigger,
      runId: run.runId,
      exclusive: run.exclusive,
      log,
    });
    /** @type {Record<string, unknown>} */
    const result = {
      ok: true,
      name: backup.name,
      path: backup.path,
      database_bytes: backup.databaseBytes,
      uploads_bytes: backup.uploadsBytes,
      uploads_files: backup.uploadsFiles,
      uploads_content_bytes: backup.uploadsContentBytes,
      verification: backup.verification,
      pruned: [],
      partials_removed: backup.partialsRemoved,
    };
    if (!values["no-prune"]) {
      try {
        const pruned = await pruneBackups(backupDir, policy, { protectedNames: [backup.name] });
        result.pruned = pruned.deleted;
        result.partials_removed = [...backup.partialsRemoved, ...pruned.partialsRemoved];
        if (pruned.deleted.length) log(`retention removed ${pruned.deleted.join(", ")}`);
      } catch (error) {
        result.prune_error = error instanceof Error ? error.message : String(error);
        log(`retention failed: ${result.prune_error}`);
      }
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      error_code: error instanceof BackupError ? error.code : BACKUP_ERROR_CODES.failed,
      verification: error instanceof BackupError ? error.verification : null,
    };
  }
}

const trigger = values.trigger ?? "CLI";
const dbFile = values.db ? resolve(values.db) : sqliteFileFromUrl(process.env.DATABASE_URL, resolve("prisma"));
if (!TRIGGERS.includes(trigger)) {
  finish({ ok: false, error: `--trigger must be one of ${TRIGGERS.join(", ")}`, error_code: BACKUP_ERROR_CODES.configuration });
} else if (!dbFile) {
  finish({
    ok: false,
    error: "DATABASE_URL is not a SQLite file: URL; the built-in backup covers SQLite only (use your database's own tools).",
    error_code: BACKUP_ERROR_CODES.configuration,
  });
} else {
  const uploadDir = values["no-uploads"] ? null : resolve(values.uploads ?? process.env.UPLOAD_DIR ?? "./.uploads");
  const backupDir = resolve(values["backup-dir"] ?? process.env.BACKUP_DIR ?? "./.backups");
  const appRunId = values["run-id"] ?? null;
  /** @type {string | null} */
  let ownRunId = null;
  let locked = null;
  try {
    ownRunId = appRunId ? null : claimOwnRun(dbFile, trigger);
  } catch (error) {
    locked = error instanceof Error ? error.message : String(error);
  }
  if (locked) {
    finish({ ok: false, error: locked, error_code: BACKUP_ERROR_CODES.failed });
  } else {
    const runId = appRunId ?? ownRunId;
    const beat = () => {
      try {
        touchRun(dbFile, /** @type {string} */ (ownRunId));
      } catch (error) {
        log(`could not refresh the run heartbeat: ${error instanceof Error ? error.message : error}`);
      }
    };
    const heartbeat = ownRunId ? setInterval(beat, BACKUP_HEARTBEAT_MS) : null;
    // Whoever holds the lock (the app's row or our own) may clear every leftover partial directory.
    const result = await backUp(dbFile, backupDir, uploadDir, { runId, trigger, exclusive: runId !== null });
    if (heartbeat) clearInterval(heartbeat);
    if (ownRunId) finishRun(dbFile, ownRunId, /** @type {import("./runs.mjs").RunResult} */ (result));
    finish(result);
  }
}
