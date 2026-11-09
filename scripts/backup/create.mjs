// Creates one backup: a snapshot of the SQLite database plus a
// tar.gz of the upload directory, written into a partial directory, verified
// there, and published with one rename. A backup that fails verification is
// deleted, so every published backup directory has passed its checks.
import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  DB_FILE_NAME,
  MANIFEST_FILE_NAME,
  PARTIAL_PREFIX,
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
  UPLOADS_FILE_NAME,
  VERIFICATION_FILE_NAME,
  backupName,
  ensurePrivateDirectory,
  isInside,
  removeStalePartials,
} from "./layout.mjs";
import { appliedMigrations, countRows, openReadOnly, snapshotDatabase } from "./sqlite.mjs";
import { writeTarGz } from "./tar.mjs";
import { sha256File, verifyBackupDirectory } from "./verify.mjs";

export const MANIFEST_FORMAT = 1;
/**
 * Space that must stay free on the backup volume AFTER the backup: the larger
 * of 1 GiB and 10 % of the volume. By default the backups share the volume
 * with the live database and uploads, which need room to keep working.
 */
export const MIN_RESERVE_BYTES = 1024 ** 3;
export const RESERVE_FRACTION = 0.1;

/**
 * Coarse failure classes. The monitoring API reports only these; the full
 * message (paths, process output) stays in the admin UI.
 */
export const BACKUP_ERROR_CODES = {
  databaseMissing: "database_missing",
  configuration: "invalid_configuration",
  insufficientSpace: "insufficient_space",
  verificationFailed: "verification_failed",
  failed: "backup_failed",
};

/**
 * @typedef {{ freeBytes: number, totalBytes: number }} DiskSpace
 * @typedef {{
 *   dbFile: string,
 *   uploadDir: string | null,
 *   backupDir: string,
 *   appVersion?: string | null,
 *   trigger?: string | null,
 *   runId?: string | null,
 *   exclusive?: boolean,
 *   now?: Date,
 *   log?: (line: string) => void,
 *   diskSpace?: (dir: string) => Promise<DiskSpace>,
 *   snapshotStepPages?: number,
 * }} CreateOptions
 * @typedef {{
 *   name: string,
 *   path: string,
 *   databaseBytes: number,
 *   uploadsBytes: number | null,
 *   uploadsFiles: number | null,
 *   uploadsContentBytes: number | null,
 *   partialsRemoved: string[],
 *   verification: import("./verify.mjs").VerificationVerdict & { checks: Record<string, unknown> },
 * }} CreatedBackup
 */

export class BackupError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, verification?: unknown }} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = "BackupError";
    this.code = details.code ?? BACKUP_ERROR_CODES.failed;
    this.verification = details.verification ?? null;
  }
}

/**
 * Bytes the backup volume must have free before a backup of `backupBytes`:
 * the backup itself plus the reserve that stays free afterwards.
 *
 * @param {number} backupBytes
 * @param {number} volumeBytes
 */
export function requiredFreeBytes(backupBytes, volumeBytes) {
  return backupBytes + Math.max(MIN_RESERVE_BYTES, Math.ceil(volumeBytes * RESERVE_FRACTION));
}

/**
 * Every regular file below `root` as an archive entry. Symlinks and special
 * files are skipped; so are in-flight `*.tmp` uploads (the storage driver
 * writes to a temp name and renames it into place).
 *
 * @param {string} root
 * @returns {Promise<{ sources: import("./tar.mjs").TarSource[], bytes: number }>}
 */
export async function listUploadFiles(root) {
  const base = resolve(root);
  /** @type {import("./tar.mjs").TarSource[]} */
  const sources = [];
  let bytes = 0;
  /** @param {string} dir */
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT" && dir === base) return;
      throw error;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else if (entry.isFile() && !entry.name.endsWith(".tmp")) {
        sources.push({ name: relative(base, abs).split(sep).join("/"), abs });
        bytes += (await stat(abs)).size;
      }
    }
  }
  await walk(base);
  return { sources, bytes };
}

/**
 * @param {string} dir
 * @returns {Promise<DiskSpace>}
 */
async function defaultDiskSpace(dir) {
  const { bavail, blocks, bsize } = await statfs(dir);
  return { freeBytes: bavail * bsize, totalBytes: blocks * bsize };
}

/** @param {number} bytes */
const megabytes = (bytes) => `${Math.ceil(bytes / (1024 * 1024))} MB`;

/**
 * @param {string} file
 * @param {unknown} value
 */
async function writeJsonDurably(file, value) {
  await writeFile(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: PRIVATE_FILE_MODE });
  const handle = await open(file, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** @param {string} dir */
async function syncDirectory(dir) {
  // Directories cannot be opened for fsync on Windows (a development platform only).
  if (process.platform === "win32") return;
  const handle = await open(dir, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
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

/**
 * Makes every file in `dir` readable by its owner only (the snapshot and the
 * archive are created with the process umask).
 *
 * @param {string} dir
 */
async function restrictFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isFile()) await chmod(join(dir, entry.name), PRIVATE_FILE_MODE);
  }
}

/**
 * Row counts of the live database, read in their own short transaction.
 *
 * @param {string} dbFile
 */
function countLiveRows(dbFile) {
  const live = openReadOnly(dbFile);
  try {
    return countRows(live);
  } finally {
    live.close();
  }
}

/**
 * A backup name that does not exist yet in `backupDir` (a second backup within
 * the same second gets a `-2` suffix).
 *
 * @param {string} backupDir
 * @param {Date} now
 */
async function freeName(backupDir, now) {
  const base = backupName(now);
  const existing = new Set(await readdir(backupDir));
  if (!existing.has(base)) return base;
  for (let i = 2; ; i++) if (!existing.has(`${base}-${i}`)) return `${base}-${i}`;
}

/**
 * Creates, verifies and publishes one backup.
 *
 * @param {CreateOptions} options
 * @returns {Promise<CreatedBackup>}
 * @throws {BackupError} when the backup cannot be made or fails verification (nothing is left behind)
 */
export async function createBackup(options) {
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const diskSpace = options.diskSpace ?? defaultDiskSpace;
  const dbFile = resolve(options.dbFile);
  const backupDir = resolve(options.backupDir);
  const uploadDir = options.uploadDir ? resolve(options.uploadDir) : null;

  const dbStats = await stat(dbFile).catch(() => null);
  if (!dbStats?.isFile()) throw new BackupError(`Database file ${dbFile} does not exist`, { code: BACKUP_ERROR_CODES.databaseMissing });
  if (uploadDir && isInside(uploadDir, backupDir)) {
    throw new BackupError(`The backup directory ${backupDir} lies inside the upload directory ${uploadDir}; choose another BACKUP_DIR`, {
      code: BACKUP_ERROR_CODES.configuration,
    });
  }
  await ensurePrivateDirectory(backupDir);
  // Leftovers of interrupted runs go first: their space counts as free for this run.
  const partialsRemoved = await removeStalePartials(backupDir, { now, exclusive: options.exclusive === true });
  if (partialsRemoved.length) log(`removed interrupted backups ${partialsRemoved.join(", ")}`);

  const uploads = uploadDir ? await listUploadFiles(uploadDir) : null;
  let journalBytes = 0;
  for (const suffix of ["-wal", "-journal"]) journalBytes += (await stat(dbFile + suffix).catch(() => null))?.size ?? 0;
  const space = await diskSpace(backupDir);
  const needed = requiredFreeBytes(dbStats.size + journalBytes + (uploads?.bytes ?? 0), space.totalBytes);
  if (space.freeBytes < needed) {
    throw new BackupError(
      `Not enough free space in ${backupDir}: ${megabytes(space.freeBytes)} free, about ${megabytes(needed)} needed ` +
        "(the backup plus a reserve of 1 GB or 10 % of the volume, whichever is larger, that stays free for the live data)",
      { code: BACKUP_ERROR_CODES.insufficientSpace },
    );
  }

  const name = await freeName(backupDir, now);
  const work = join(backupDir, `${PARTIAL_PREFIX}${name}-${randomUUID()}`);
  await mkdir(work, { mode: PRIVATE_DIR_MODE });
  try {
    log(`snapshotting ${dbFile}`);
    const liveBefore = countLiveRows(dbFile);
    const snapshot = await snapshotDatabase(dbFile, join(work, DB_FILE_NAME), { stepPages: options.snapshotStepPages, log });
    const liveAfter = countLiveRows(dbFile);
    await syncFile(join(work, DB_FILE_NAME));
    const copy = openReadOnly(join(work, DB_FILE_NAME));
    let migrations;
    try {
      migrations = appliedMigrations(copy);
    } finally {
      copy.close();
    }
    const databaseBytes = (await stat(join(work, DB_FILE_NAME))).size;
    const databaseSha256 = await sha256File(join(work, DB_FILE_NAME));

    /** @type {Record<string, unknown> | null} */
    let uploadsManifest = null;
    if (uploadDir && uploads) {
      log(`archiving ${uploads.sources.length} files from ${uploadDir}`);
      const written = await writeTarGz(join(work, UPLOADS_FILE_NAME), uploads.sources);
      await syncFile(join(work, UPLOADS_FILE_NAME));
      uploadsManifest = {
        file: UPLOADS_FILE_NAME,
        source: uploadDir,
        files: written.files,
        content_bytes: written.bytes,
        bytes: written.archiveBytes,
        sha256: written.sha256,
        skipped: written.skipped.length,
      };
    }

    const manifest = {
      format: MANIFEST_FORMAT,
      name,
      created_at: now.toISOString(),
      app_version: options.appVersion ?? null,
      trigger: options.trigger ?? null,
      run_id: options.runId ?? null,
      snapshot: { method: snapshot.method, attempts: snapshot.attempts },
      database: { file: DB_FILE_NAME, source: dbFile, bytes: databaseBytes, sha256: databaseSha256 },
      uploads: uploadsManifest,
      migrations,
      live_counts_before: liveBefore,
      live_counts_after: liveAfter,
    };
    await writeJsonDurably(join(work, MANIFEST_FILE_NAME), manifest);

    log("verifying");
    const verification = await verifyBackupDirectory(work, manifest, { liveBefore, liveAfter });
    if (!verification.ok) {
      throw new BackupError(`Verification failed: ${verification.problems.join("; ")}`, {
        code: BACKUP_ERROR_CODES.verificationFailed,
        verification,
      });
    }
    await writeJsonDurably(join(work, VERIFICATION_FILE_NAME), { ...verification, verified_at: new Date().toISOString() });
    await restrictFiles(work);
    await syncDirectory(work);

    const path = join(backupDir, name);
    await rename(work, path);
    await syncDirectory(backupDir);
    log(`published ${path}`);
    return {
      name,
      path,
      databaseBytes,
      uploadsBytes: uploadsManifest ? Number(uploadsManifest.bytes) : null,
      uploadsFiles: uploadsManifest ? Number(uploadsManifest.files) : null,
      uploadsContentBytes: uploadsManifest ? Number(uploadsManifest.content_bytes) : null,
      partialsRemoved,
      verification,
    };
  } catch (error) {
    await rm(work, { recursive: true, force: true });
    if (error instanceof BackupError) throw error;
    throw new BackupError(error instanceof Error ? error.message : String(error));
  }
}
