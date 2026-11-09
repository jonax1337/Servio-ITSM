// Layout of the backup directory, retention and the paths the backup works on.
// Filesystem only (no SQLite), so the app can import it to list and prune.
//
//   <BACKUP_DIR>/
//     servio-backup-20261119T023000Z/     one published backup (always verified)
//       servio.db                          VACUUM INTO copy of the database
//       uploads.tar.gz                     the upload directory (absent when uploads are excluded)
//       manifest.json                      what was backed up: sizes, sha256, migrations, row counts
//       verification.json                  the checks the backup passed before it was published
//     .partial-servio-backup-…-<uuid>/     a backup in progress (or left by an interrupted one)
import { lstat, readdir, readFile, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export const BACKUP_PREFIX = "servio-backup-";
const BACKUP_NAME = /^servio-backup-(\d{8})T(\d{6})Z(?:-(\d+))?$/;
export const PARTIAL_PREFIX = ".partial-";
export const DB_FILE_NAME = "servio.db";
export const UPLOADS_FILE_NAME = "uploads.tar.gz";
export const MANIFEST_FILE_NAME = "manifest.json";
export const VERIFICATION_FILE_NAME = "verification.json";
/**
 * Liveness file the running app keeps fresh in SERVIO_STATE_DIR (written by the
 * backup scheduler tick, removed on a clean shutdown). The restore script
 * refuses to run while it is fresh.
 */
export const APP_HEARTBEAT_FILE = "app-heartbeat.json";
/** The app rewrites the heartbeat every minute; older than this means it is gone. */
export const APP_HEARTBEAT_STALE_MS = 3 * 60 * 1000;
/** A partial directory younger than this may belong to a backup that is still running. */
const PARTIAL_GRACE_MS = 12 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{ name: string, createdAt: Date }} BackupRef
 * @typedef {{ keepCount: number, keepDays: number }} RetentionPolicy
 * @typedef {BackupRef & { path: string, verified: boolean, bytes: number, manifest: Record<string, unknown> | null }} BackupInfo
 */

/**
 * @param {Date} at
 * @returns {string} e.g. `servio-backup-20261119T023000Z`
 */
export function backupName(at) {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${BACKUP_PREFIX}${stamp}`;
}

/**
 * @param {string} name
 * @returns {Date | null} the creation time encoded in a backup directory name
 */
export function parseBackupName(name) {
  const match = BACKUP_NAME.exec(name);
  if (!match) return null;
  const [, day, time] = match;
  const at = new Date(
    `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`,
  );
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Clamps a retention policy to sane bounds: at least one backup is always kept.
 *
 * @param {{ keepCount?: number | null, keepDays?: number | null }} policy
 * @returns {RetentionPolicy}
 */
export function normalizeRetention({ keepCount, keepDays }) {
  const count = Number.isFinite(keepCount) ? Math.floor(Number(keepCount)) : 7;
  const days = Number.isFinite(keepDays) ? Math.floor(Number(keepDays)) : 14;
  return { keepCount: Math.min(1000, Math.max(1, count)), keepDays: Math.min(3650, Math.max(0, days)) };
}

/**
 * The backups retention deletes. A backup is kept when it is one of the newest
 * `keepCount`, OR younger than `keepDays` days (0 = count only), OR protected
 * (the backup that was just made). Everything else expires.
 *
 * @param {BackupRef[]} backups
 * @param {RetentionPolicy} policy
 * @param {Date} now
 * @param {string[]} [protectedNames]
 * @returns {string[]} names of the expired backups, oldest last
 */
export function selectExpiredBackups(backups, policy, now, protectedNames = []) {
  const { keepCount, keepDays } = normalizeRetention(policy);
  const newestFirst = [...backups].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.name.localeCompare(a.name));
  const minimumAge = keepDays * DAY_MS;
  return newestFirst
    .filter((backup, index) => {
      if (index < keepCount) return false;
      if (protectedNames.includes(backup.name)) return false;
      if (keepDays > 0 && now.getTime() - backup.createdAt.getTime() < minimumAge) return false;
      return true;
    })
    .map((backup) => backup.name);
}

/**
 * @param {string} file
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function readJson(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} dir
 * @returns {Promise<number>} total size of the regular files directly inside `dir`
 */
async function directoryBytes(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isFile()) total += (await stat(join(dir, entry.name))).size;
  }
  return total;
}

/**
 * The published backups in `backupDir`, newest first. A missing directory is empty.
 *
 * @param {string} backupDir
 * @returns {Promise<BackupInfo[]>}
 */
export async function listBackups(backupDir) {
  let entries;
  try {
    entries = await readdir(backupDir, { withFileTypes: true });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return [];
    throw error;
  }
  /** @type {BackupInfo[]} */
  const backups = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const createdAt = parseBackupName(entry.name);
    if (!createdAt) continue;
    const path = join(backupDir, entry.name);
    const verification = await readJson(join(path, VERIFICATION_FILE_NAME));
    backups.push({
      name: entry.name,
      createdAt,
      path,
      verified: verification?.ok === true,
      bytes: await directoryBytes(path),
      manifest: await readJson(join(path, MANIFEST_FILE_NAME)),
    });
  }
  return backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.name.localeCompare(a.name));
}

/**
 * Applies retention to `backupDir` and removes partial directories left by
 * interrupted backups.
 *
 * @param {string} backupDir
 * @param {RetentionPolicy} policy
 * @param {{ now?: Date, protectedNames?: string[] }} [options]
 * @returns {Promise<{ deleted: string[], partialsRemoved: string[] }>}
 */
export async function pruneBackups(backupDir, policy, { now = new Date(), protectedNames = [] } = {}) {
  const backups = await listBackups(backupDir);
  const deleted = selectExpiredBackups(backups, policy, now, protectedNames);
  for (const name of deleted) await rm(join(backupDir, name), { recursive: true, force: true });

  /** @type {string[]} */
  const partialsRemoved = [];
  for (const entry of await readdir(backupDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(PARTIAL_PREFIX)) continue;
    const info = await lstat(join(backupDir, entry.name));
    if (now.getTime() - info.mtimeMs < PARTIAL_GRACE_MS) continue;
    await rm(join(backupDir, entry.name), { recursive: true, force: true });
    partialsRemoved.push(entry.name);
  }
  return { deleted, partialsRemoved };
}

/**
 * The SQLite file behind a Prisma `DATABASE_URL`, or null for any other
 * database. Relative paths are resolved like Prisma does: against the directory
 * of `schema.prisma`.
 *
 * @param {string | undefined | null} databaseUrl
 * @param {string} schemaDir
 * @returns {string | null}
 */
export function sqliteFileFromUrl(databaseUrl, schemaDir) {
  const url = (databaseUrl ?? "").trim();
  if (!url.startsWith("file:")) return null;
  let path = url.slice("file:".length);
  const query = path.indexOf("?");
  if (query !== -1) path = path.slice(0, query);
  if (path.startsWith("//")) path = path.slice(2);
  if (!path) return null;
  return isAbsolute(path) ? resolve(path) : resolve(schemaDir, path);
}

/**
 * @param {string} parent
 * @param {string} child
 * @returns {boolean} whether `child` is `parent` or lies inside it
 */
export function isInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
