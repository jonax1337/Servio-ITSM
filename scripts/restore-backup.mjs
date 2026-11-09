#!/usr/bin/env node
// Restores a Servio backup (database + uploads) made by the built-in backup.
// Run it with the app STOPPED. Full procedure: docs/backup.md.
//
//   node scripts/restore-backup.mjs --list
//   node scripts/restore-backup.mjs <name | latest | path> --dry-run
//   node scripts/restore-backup.mjs <name | latest | path> --yes
//
// Options:
//   --backup-dir DIR     where the backups are (default BACKUP_DIR, else ./.backups)
//   --db FILE            the database to replace (default: the SQLite file of DATABASE_URL)
//   --uploads DIR        the upload directory to replace (default UPLOAD_DIR, else ./.uploads)
//   --state-dir DIR      the app's state directory (default SERVIO_STATE_DIR, else ./.servio-state)
//   --migrations-dir DIR the migrations this version ships (default ./prisma/migrations)
//   --skip-uploads       restore the database only
//   --force              restore although the app looks alive or the backup has unknown migrations
//
// The backup is verified first (checksums, PRAGMA integrity_check, the archive
// read end to end). The current database and upload directory are kept as
// `*.pre-restore-<time>` next to the originals; nothing is deleted.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  APP_HEARTBEAT_FILE,
  APP_HEARTBEAT_STALE_MS,
  BACKUP_PREFIX,
  DB_FILE_NAME,
  MANIFEST_FILE_NAME,
  UPLOADS_FILE_NAME,
  VERIFICATION_FILE_NAME,
  backupName,
  listBackups,
  readJson,
  sqliteFileFromUrl,
} from "./backup/layout.mjs";
import { settleRestoredRuns } from "./backup/runs.mjs";
import { canLockExclusively } from "./backup/sqlite.mjs";
import { extractTarGz } from "./backup/tar.mjs";
import { verifyBackupDirectory } from "./backup/verify.mjs";

const SIDECARS = ["-wal", "-shm", "-journal"];

const { values, positionals } = parseArgs({
  options: {
    list: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    "skip-uploads": { type: "boolean", default: false },
    "backup-dir": { type: "string" },
    db: { type: "string" },
    uploads: { type: "string" },
    "state-dir": { type: "string" },
    "migrations-dir": { type: "string" },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const say = (/** @type {string} */ line = "") => process.stdout.write(line + "\n");
const fail = (/** @type {string} */ message, code = 1) => {
  process.stderr.write(`restore: ${message}\n`);
  process.exit(code);
};
const mb = (/** @type {number} */ bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
/** @param {unknown} error */
const codeOf = (error) => /** @type {NodeJS.ErrnoException} */ (error)?.code;

/** @param {string} path */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (codeOf(error) === "ENOENT") return false;
    throw error;
  }
}

/** @param {string} file */
async function syncFile(file) {
  const handle = await open(file, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

if (values.help) {
  say("Usage: node scripts/restore-backup.mjs --list");
  say("       node scripts/restore-backup.mjs <name|latest|path> (--dry-run | --yes) [--skip-uploads] [--force]");
  say("       [--backup-dir DIR] [--db FILE] [--uploads DIR] [--state-dir DIR] [--migrations-dir DIR]");
  say("See docs/backup.md for the full procedure.");
  process.exit(0);
}

const backupDir = resolve(values["backup-dir"] ?? process.env.BACKUP_DIR ?? "./.backups");

if (values.list) {
  const backups = await listBackups(backupDir);
  if (backups.length === 0) {
    say(`No backups in ${backupDir}.`);
    process.exit(0);
  }
  say(`Backups in ${backupDir} (newest first):`);
  for (const backup of backups) {
    const manifest = backup.manifest ?? {};
    const uploads = /** @type {Record<string, unknown> | null} */ (manifest.uploads ?? null);
    const parts = [
      backup.name,
      backup.createdAt.toISOString(),
      backup.verified ? "verified" : "NOT verified",
      `total ${mb(backup.bytes)}`,
      uploads ? `${uploads.files} files` : "no uploads",
      manifest.app_version ? `version ${manifest.app_version}` : null,
    ];
    say(`  ${parts.filter(Boolean).join("  ·  ")}`);
  }
  process.exit(0);
}

const target = positionals[0];
if (!target) fail("name the backup to restore (or use --list). See --help.", 2);
if (!values["dry-run"] && !values.yes) fail("add --dry-run to check the backup, or --yes to restore it (with the app stopped).", 2);

// ── Locate the backup ────────────────────────────────────────────────────────
let source;
if (target === "latest") {
  const newest = (await listBackups(backupDir)).find((backup) => backup.verified);
  if (!newest) fail(`no verified backup in ${backupDir}`);
  source = newest.path;
} else if (isAbsolute(target) || target.includes("/") || target.includes("\\")) {
  source = resolve(target);
} else {
  source = join(backupDir, target);
}
const manifest = await readJson(join(source, MANIFEST_FILE_NAME));
if (!manifest) fail(`${source} is not a Servio backup (no readable ${MANIFEST_FILE_NAME})`);

const dbFile = values.db ? resolve(values.db) : sqliteFileFromUrl(process.env.DATABASE_URL, resolve("prisma"));
if (!dbFile) fail("DATABASE_URL is not a SQLite file: URL; pass --db with the database file to replace");
const uploadDir = resolve(values.uploads ?? process.env.UPLOAD_DIR ?? "./.uploads");
const stateDir = resolve(values["state-dir"] ?? process.env.SERVIO_STATE_DIR ?? "./.servio-state");
const migrationsDir = resolve(values["migrations-dir"] ?? "prisma/migrations");
const uploads = /** @type {Record<string, unknown> | null} */ (manifest.uploads ?? null);
const restoreUploads = Boolean(uploads) && !values["skip-uploads"];

say(`Backup:   ${source}`);
say(`          created ${manifest.created_at ?? "?"}${manifest.app_version ? ` by version ${manifest.app_version}` : ""}`);
say(`Database: ${dbFile}`);
say(`Uploads:  ${restoreUploads ? uploadDir : uploads ? "skipped (--skip-uploads)" : "not part of this backup"}`);
say();

// ── 1. Verify the backup ─────────────────────────────────────────────────────
say("Verifying the backup…");
const verification = await verifyBackupDirectory(source, manifest);
for (const warning of verification.warnings) say(`  warning: ${warning}`);
if (!verification.ok) {
  for (const problem of verification.problems) say(`  problem: ${problem}`);
  fail("the backup failed verification; it was not restored.");
}
say("  ok: checksums match, integrity_check ok, archive readable.");

// ── 2. Migrations: can this version run on the restored database? ────────────
const backupMigrations = Array.isArray(manifest.migrations) ? manifest.migrations.map(String) : [];
let shipped = null;
try {
  shipped = new Set((await readdir(migrationsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
} catch {
  say(`  note: ${migrationsDir} not found; skipping the migration comparison.`);
}
if (shipped) {
  const unknown = backupMigrations.filter((name) => !shipped.has(name));
  const pending = [...shipped].filter((name) => !backupMigrations.includes(name)).sort();
  if (unknown.length > 0) {
    say(`  The backup was made by a NEWER version (unknown migrations: ${unknown.join(", ")}).`);
    say("  This version would refuse to start on it. Run the version that made the backup.");
    if (!values.force) fail("refusing to restore a backup from a newer version (use --force to restore anyway).");
  }
  if (pending.length > 0) say(`  ${pending.length} newer migration(s) will be applied when the app starts.`);
}

// ── 3. The app must be stopped ───────────────────────────────────────────────
const heartbeat = await readJson(join(stateDir, APP_HEARTBEAT_FILE));
const beat = heartbeat && typeof heartbeat.at === "string" ? Date.parse(heartbeat.at) : NaN;
const appAlive = Number.isFinite(beat) && Date.now() - beat < APP_HEARTBEAT_STALE_MS;
const dbExists = await exists(dbFile);
const locked = dbExists && !canLockExclusively(dbFile);
if (appAlive || locked) {
  say(
    appAlive
      ? `  The app looks ALIVE (heartbeat ${heartbeat?.at} in ${stateDir}).`
      : "  The database is locked by another process.",
  );
  if (!values.force) fail("stop the app first (docker compose stop web), wait a moment, then run this again. --force overrides.");
}

// ── 4. Plan ──────────────────────────────────────────────────────────────────
const stamp = backupName(new Date()).slice(BACKUP_PREFIX.length);
const dbAside = `${dbFile}.pre-restore-${stamp}`;
const uploadsAside = `${uploadDir}.pre-restore-${stamp}`;
say();
say("Plan:");
say(`  1. ${dbExists ? `keep the current database as ${dbAside}` : "no current database (fresh volume)"}`);
say(`  2. replace ${dbFile} with the backup's ${DB_FILE_NAME} (${mb(Number(/** @type {Record<string, unknown>} */ (manifest.database ?? {}).bytes ?? 0))})`);
if (restoreUploads) {
  say(`  3. ${(await exists(uploadDir)) ? `keep the current uploads as ${uploadsAside} (or inside it when it is a mount point)` : "no current upload directory"}`);
  say(`  4. unpack ${uploads?.files} files (${mb(Number(uploads?.content_bytes ?? 0))}) into ${uploadDir}`);
}
if (values["dry-run"]) {
  say();
  say("Dry run: nothing was changed.");
  process.exit(0);
}

// ── 5. Restore the database ──────────────────────────────────────────────────
/**
 * The snapshot holds the run that took it as RUNNING; record it as the
 * verified backup it became (the app would otherwise mark it interrupted).
 *
 * @param {string} file the restored copy, before it is put in place
 */
async function settleSnapshotRun(file) {
  const verified = await readJson(join(source, VERIFICATION_FILE_NAME));
  const finishedAt = new Date(String(verified?.verified_at ?? manifest.created_at ?? new Date().toISOString()));
  const database = /** @type {Record<string, unknown>} */ (manifest.database ?? {});
  const runs = settleRestoredRuns(file, {
    runId: typeof manifest.run_id === "string" ? manifest.run_id : null,
    name: String(manifest.name ?? basename(source)),
    finishedAt: Number.isNaN(finishedAt.getTime()) ? new Date() : finishedAt,
    databaseBytes: typeof database.bytes === "number" ? database.bytes : null,
    uploadsBytes: typeof uploads?.bytes === "number" ? uploads.bytes : null,
    uploadsFiles: typeof uploads?.files === "number" ? uploads.files : null,
  });
  if (runs.settled || runs.interrupted) {
    say(`  run history: the backup's own run recorded as verified${runs.interrupted ? `, ${runs.interrupted} run(s) in progress at that moment marked interrupted` : ""}.`);
  }
}

say();
await mkdir(dirname(dbFile), { recursive: true });
/** @type {string[]} */
const dbSafety = [];
if (dbExists) {
  for (const suffix of ["", ...SIDECARS]) {
    if (!(await exists(dbFile + suffix))) continue;
    await copyFile(dbFile + suffix, dbAside + suffix, constants.COPYFILE_EXCL);
    dbSafety.push(suffix);
  }
}
const temp = `${dbFile}.restore-${randomUUID()}`;
try {
  await copyFile(join(source, DB_FILE_NAME), temp, constants.COPYFILE_EXCL);
  await settleSnapshotRun(temp);
  await syncFile(temp);
  // The old WAL / journal belong to the old database; replayed onto the restored one they would corrupt it.
  for (const suffix of SIDECARS) await rm(dbFile + suffix, { force: true });
  await rename(temp, dbFile);
} catch (error) {
  await rm(temp, { force: true });
  if (dbExists) {
    for (const suffix of dbSafety) await copyFile(dbAside + suffix, dbFile + suffix);
  }
  fail(`restoring the database failed (${error instanceof Error ? error.message : error}); the previous database is back in place.`);
}
say(`Database restored${dbExists ? ` (previous one kept as ${dbAside})` : ""}.`);

// ── 6. Restore the uploads ───────────────────────────────────────────────────
async function rollbackDatabase() {
  if (!dbExists) return;
  for (const suffix of SIDECARS) await rm(dbFile + suffix, { force: true });
  for (const suffix of dbSafety) await copyFile(dbAside + suffix, dbFile + suffix);
}

if (restoreUploads && uploads) {
  const archive = join(source, String(uploads.file ?? UPLOADS_FILE_NAME));
  const hadUploads = await exists(uploadDir);
  const parent = dirname(uploadDir);
  await mkdir(parent, { recursive: true });
  // A mount point cannot be renamed: then the swap happens inside the directory.
  const inPlace = hadUploads && (await stat(uploadDir)).dev !== (await stat(parent)).dev;
  const staging = inPlace ? join(uploadDir, `.restore-${randomUUID()}`) : join(parent, `.${basename(uploadDir)}-restore-${randomUUID()}`);
  try {
    say(`Unpacking ${uploads.files} files…`);
    const extracted = await extractTarGz(archive, staging);
    if (!inPlace) {
      if (hadUploads) await rename(uploadDir, uploadsAside);
      try {
        await rename(staging, uploadDir);
      } catch (error) {
        if (hadUploads) await rename(uploadsAside, uploadDir);
        throw error;
      }
      say(`Uploads restored: ${extracted.files} files${hadUploads ? ` (previous ones kept as ${uploadsAside})` : ""}.`);
    } else {
      const aside = join(uploadDir, `.pre-restore-${stamp}`);
      await mkdir(aside);
      const keep = new Set([basename(staging), basename(aside)]);
      for (const entry of await readdir(uploadDir)) if (!keep.has(entry)) await rename(join(uploadDir, entry), join(aside, entry));
      for (const entry of await readdir(staging)) await rename(join(staging, entry), join(uploadDir, entry));
      await rm(staging, { recursive: true, force: true });
      say(`Uploads restored: ${extracted.files} files (previous ones kept in ${aside}).`);
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    await rollbackDatabase();
    fail(
      `restoring the uploads failed (${error instanceof Error ? error.message : error}); the previous database was put back. ` +
        "Check the upload directory before starting the app.",
    );
  }
}

say();
say("Done. Next steps:");
say("  - start the app (docker compose start web); pending migrations are applied at boot;");
say("  - sign in and check recent tickets and a few attachments;");
say("  - delete the *.pre-restore-* copies once you are satisfied.");
