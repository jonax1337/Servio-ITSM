// Layout of the backup directory, retention and the paths the backup works on.
// Filesystem only (no SQLite), so the app can import it to list and prune.
//
//   <BACKUP_DIR>/
//     servio-backup-20261119T023000Z/     one published backup (always verified)
//       servio.db                          snapshot of the database (SQLite backup API)
//       uploads.tar.gz                     the upload directory (absent when uploads are excluded)
//       manifest.json                      what was backed up: sizes, sha256, migrations, row counts
//       verification.json                  the checks the backup passed before it was published
//     .partial-servio-backup-…-<uuid>/     a backup in progress (or left by an interrupted one)
//
// Backups hold every record: the directories are created 0700, the files 0600.
import { chmod, lstat, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
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
/** A heartbeat older than this means the app is gone. */
export const APP_HEARTBEAT_STALE_MS = 3 * 60 * 1000;
/** Longest allowed heartbeat interval: two missed beats still fit into the stale window. */
export const APP_HEARTBEAT_MAX_INTERVAL_MS = 90 * 1000;
export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
/** A RUNNING backup run (BackupRun row) refreshes its heartbeat this often… */
export const BACKUP_HEARTBEAT_MS = 30_000;
/** …and counts as interrupted (its process is gone) when the heartbeat is older than this. */
export const BACKUP_RUN_STALE_MS = 3 * 60_000;
/** Backups started by hand (Back up now, the CLI) are kept by count only: the newest this many. */
export const ON_DEMAND_KEEP_COUNT = 3;
/** A partial directory younger than this may belong to a backup that is still running. */
const PARTIAL_GRACE_MS = 12 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {{ name: string, createdAt: Date, trigger?: string | null }} BackupRef
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
 * Whether a backup was started by hand (Back up now, the CLI) rather than by
 * the schedule. Backups without a recorded trigger count as scheduled.
 *
 * @param {BackupRef} backup
 */
export const isOnDemandBackup = (backup) => Boolean(backup.trigger) && backup.trigger !== "SCHEDULE";

/**
 * The backups retention deletes. Scheduled backups follow the policy: one is
 * kept when it is one of the newest `keepCount`, OR younger than `keepDays`
 * days (0 = count only). Backups started by hand are kept by count only (the
 * newest ON_DEMAND_KEEP_COUNT), so repeated manual runs neither pile up for
 * `keepDays` nor push scheduled backups out. Protected backups (the one that
 * was just made) are always kept.
 *
 * @param {BackupRef[]} backups
 * @param {RetentionPolicy} policy
 * @param {Date} now
 * @param {string[]} [protectedNames]
 * @returns {string[]} names of the expired backups, newest first
 */
export function selectExpiredBackups(backups, policy, now, protectedNames = []) {
  const { keepCount, keepDays } = normalizeRetention(policy);
  const newestFirst = [...backups].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.name.localeCompare(a.name));
  const minimumAge = keepDays * DAY_MS;
  const youngEnough = (/** @type {BackupRef} */ backup) => keepDays > 0 && now.getTime() - backup.createdAt.getTime() < minimumAge;
  const expired = new Set([
    ...newestFirst.filter((backup) => !isOnDemandBackup(backup)).filter((backup, index) => index >= keepCount && !youngEnough(backup)),
    ...newestFirst.filter(isOnDemandBackup).slice(ON_DEMAND_KEEP_COUNT),
  ]);
  return newestFirst.filter((backup) => expired.has(backup) && !protectedNames.includes(backup.name)).map((backup) => backup.name);
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
    const manifest = await readJson(join(path, MANIFEST_FILE_NAME));
    backups.push({
      name: entry.name,
      createdAt,
      trigger: typeof manifest?.trigger === "string" ? manifest.trigger : null,
      path,
      verified: verification?.ok === true,
      bytes: await directoryBytes(path),
      manifest,
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
  return { deleted, partialsRemoved: await removeStalePartials(backupDir, { now }) };
}

/**
 * Removes partial directories left by interrupted backups. Without
 * `exclusive`, partials younger than 12 hours are kept (they may belong to a
 * backup that is still running); a caller holding the backup lock passes
 * `exclusive: true`, because then no other backup can be writing.
 *
 * @param {string} backupDir
 * @param {{ now?: Date, exclusive?: boolean }} [options]
 * @returns {Promise<string[]>} the names of the removed directories
 */
export async function removeStalePartials(backupDir, { now = new Date(), exclusive = false } = {}) {
  /** @type {string[]} */
  const removed = [];
  for (const entry of await readdir(backupDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(PARTIAL_PREFIX)) continue;
    const info = await lstat(join(backupDir, entry.name));
    if (!exclusive && now.getTime() - info.mtimeMs < PARTIAL_GRACE_MS) continue;
    await rm(join(backupDir, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

/**
 * Creates the backup directory with mode 0700, or tightens an existing one.
 *
 * @param {string} backupDir
 */
export async function ensurePrivateDirectory(backupDir) {
  await mkdir(backupDir, { recursive: true, mode: PRIVATE_DIR_MODE });
  // A mount point owned by another user cannot be tightened (EPERM); each
  // backup's own directory is 0700 regardless, so that is no reason to fail.
  await chmod(backupDir, PRIVATE_DIR_MODE).catch((error) => {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EPERM") throw error;
  });
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
