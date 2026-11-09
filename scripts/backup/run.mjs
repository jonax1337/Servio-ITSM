#!/usr/bin/env node
// Runs one backup (create + verify + publish) and applies retention.
//
// The app starts this as a child process, so the snapshot, the archive and the
// verification never block its event loop; operators can run it by hand too:
//
//   node scripts/backup/run.mjs [--json] [--db FILE] [--uploads DIR | --no-uploads]
//                               [--backup-dir DIR] [--keep-count N] [--keep-days N]
//                               [--no-prune] [--app-version V]
//
// Defaults come from the environment the app uses: DATABASE_URL (SQLite file:
// URL, relative paths resolve against ./prisma like Prisma does), UPLOAD_DIR
// (./.uploads), BACKUP_DIR (./.backups), BACKUP_RETENTION_COUNT (7) and
// BACKUP_RETENTION_DAYS (14). With --json the result is one JSON line on stdout;
// progress goes to stderr. Exit code 0 = verified backup published, 1 = failed.
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { BackupError, createBackup } from "./create.mjs";
import { normalizeRetention, pruneBackups, sqliteFileFromUrl } from "./layout.mjs";

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
    "app-version": { type: "string" },
    help: { type: "boolean", default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  process.stdout.write(
    "Usage: node scripts/backup/run.mjs [--json] [--db FILE] [--uploads DIR | --no-uploads] [--backup-dir DIR]\n" +
      "                                   [--keep-count N] [--keep-days N] [--no-prune] [--app-version V]\n",
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

const dbFile = values.db ? resolve(values.db) : sqliteFileFromUrl(process.env.DATABASE_URL, resolve("prisma"));
if (!dbFile) {
  finish({ ok: false, error: "DATABASE_URL is not a SQLite file: URL; the built-in backup covers SQLite only (use your database's own tools)." });
} else {
  const uploadDir = values["no-uploads"] ? null : resolve(values.uploads ?? process.env.UPLOAD_DIR ?? "./.uploads");
  const backupDir = resolve(values["backup-dir"] ?? process.env.BACKUP_DIR ?? "./.backups");
  const policy = normalizeRetention({
    keepCount: envNumber(values["keep-count"] ?? process.env.BACKUP_RETENTION_COUNT),
    keepDays: envNumber(values["keep-days"] ?? process.env.BACKUP_RETENTION_DAYS),
  });
  try {
    const backup = await createBackup({ dbFile, uploadDir, backupDir, appVersion: values["app-version"] ?? null, log });
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
      partials_removed: [],
    };
    if (!values["no-prune"]) {
      try {
        const pruned = await pruneBackups(backupDir, policy, { protectedNames: [backup.name] });
        result.pruned = pruned.deleted;
        result.partials_removed = pruned.partialsRemoved;
        if (pruned.deleted.length) log(`retention removed ${pruned.deleted.join(", ")}`);
      } catch (error) {
        result.prune_error = error instanceof Error ? error.message : String(error);
        log(`retention failed: ${result.prune_error}`);
      }
    }
    finish(result);
  } catch (error) {
    finish({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      verification: error instanceof BackupError ? error.verification : null,
    });
  }
}
