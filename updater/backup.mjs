// SQLite backup, restore and rotation. The container is stopped before
// `createBackup` runs, so copying the files is a consistent snapshot (a hot
// rollback journal left by a killed process is part of that snapshot).
// The database directory is writable by the app, so every source is checked to
// be a regular file and no destination is ever written through a symlink.
import { randomUUID } from "node:crypto";
import { link, lstat, readdir, rename, rm, stat, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertRealDirectory, copyRegularFile, regularFileExists, syncDirectory } from "./safe-fs.mjs";

/**
 * Files SQLite keeps next to the database: the WAL and its index (WAL mode) and
 * the rollback journal (the default `delete` journal mode). Each one that exists
 * belongs to the database state and is replayed when the database is opened.
 */
const SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"];
const BACKUP_NAME = /^servio-.+-(\d{8}T\d{6}Z)\.db$/;
/** Marks a copy that is not complete yet; it never carries a backup's final name. */
const PARTIAL_MARK = ".partial-";
const LEFTOVER_PARTIAL = /\.partial-[0-9a-f-]{36}$/;
/** Head room on top of the database size, so the new version can still write after a restore. */
const MIN_FREE_MARGIN_BYTES = 64 * 1024 * 1024;

/**
 * @typedef {{ path: string, sidecars: string[] }} Backup
 *   `sidecars` are the suffixes (`-wal`, `-shm`, `-journal`) that existed next to the database.
 */

/**
 * Checks that the database (and any sidecar next to it) can be backed up.
 *
 * @param {string} dbFile
 * @returns {Promise<string[]>} the sidecar suffixes that exist
 * @throws {import("./safe-fs.mjs").UnsafeFileError} when the database or a sidecar is not a regular file
 * @throws {Error} when the database does not exist
 */
export async function findBackupSources(dbFile) {
  if (!(await regularFileExists(dbFile))) throw new Error(`Database file ${dbFile} does not exist; nothing to back up`);
  const sidecars = [];
  for (const suffix of SIDECAR_SUFFIXES) {
    if (await regularFileExists(dbFile + suffix)) sidecars.push(suffix);
  }
  return sidecars;
}

/**
 * Copies the database and its sidecars. Every file is copied to a temp name,
 * flushed, and then hard-linked to its final name (which fails if that name
 * exists), so a final name never holds a truncated copy. The database file is
 * published last: once it exists, its sidecars are complete.
 *
 * @param {{ dbFile: string, backupDir: string, fromVersion: string | null, at: Date }} options
 * @returns {Promise<Backup>}
 * @throws {import("./safe-fs.mjs").UnsafeFileError} when the database or a sidecar is not a regular file
 */
export async function createBackup({ dbFile, backupDir, fromVersion, at }) {
  await assertRealDirectory(backupDir);
  const sidecars = await findBackupSources(dbFile);

  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const version = (fromVersion ?? "unknown").replace(/[^0-9A-Za-z.+-]/g, "_");
  const path = join(backupDir, `servio-${version}-${stamp}.db`);

  /** @type {string[]} */
  const published = [];
  try {
    for (const suffix of [...sidecars, ""]) {
      await publishCopy(dbFile + suffix, path + suffix);
      published.push(path + suffix);
    }
  } catch (error) {
    for (const file of published) await rm(file, { force: true });
    throw error;
  }
  await syncDirectory(backupDir);
  return { path, sidecars };
}

/**
 * @param {string} source
 * @param {string} destination must not exist yet
 */
async function publishCopy(source, destination) {
  const temporary = `${destination}${PARTIAL_MARK}${randomUUID()}`;
  try {
    await copyRegularFile(source, temporary);
    await link(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Puts the backed-up files back and removes sidecars that did not exist at
 * backup time (a WAL or hot journal left by the new version would otherwise be
 * replayed onto the restored database). Each file is copied to an exclusive
 * temp file next to the target and renamed over it, which replaces a planted
 * symlink instead of writing through it.
 *
 * @param {string} dbFile
 * @param {Backup} backup
 */
export async function restoreBackup(dbFile, backup) {
  await replaceFromBackup(backup.path, dbFile);
  for (const suffix of SIDECAR_SUFFIXES) {
    if (backup.sidecars.includes(suffix)) await replaceFromBackup(backup.path + suffix, dbFile + suffix);
    else await rm(dbFile + suffix, { force: true });
  }
  await syncDirectory(dirname(dbFile));
}

/**
 * @param {string} backupFile
 * @param {string} target
 */
async function replaceFromBackup(backupFile, target) {
  const temporary = `${target}.restore-${randomUUID()}`;
  try {
    await copyRegularFile(backupFile, temporary);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * @param {string} dir
 * @returns {Promise<number>} bytes available to an unprivileged user on the filesystem of `dir`
 */
export async function freeBytesOn(dir) {
  const { bavail, bsize } = await statfs(dir);
  return bavail * bsize;
}

/**
 * Refuses an update that could not finish its backup, or could not restore it on
 * rollback: the backup directory needs room for a copy of the database, the
 * database directory for the temp copy a restore writes (both together when
 * they share a filesystem), each plus a margin. The app is still running, so a
 * rollback journal can come and go between listing and measuring it.
 *
 * @param {{ dbFile: string, backupDir: string, freeBytes: (dir: string) => Promise<number> }} options
 * @throws {Error} when either directory lacks the space
 */
export async function assertFreeSpace({ dbFile, backupDir, freeBytes }) {
  let databaseBytes = 0;
  for (const suffix of ["", ...(await findBackupSources(dbFile))]) databaseBytes += await sizeIfPresent(dbFile + suffix);
  const dataDir = dirname(dbFile);
  const shared = (await stat(dataDir)).dev === (await stat(backupDir)).dev;
  const copies = shared ? 2 : 1;
  const needed = copies * databaseBytes + Math.max(databaseBytes / 10, MIN_FREE_MARGIN_BYTES);

  for (const dir of shared ? [backupDir] : [backupDir, dataDir]) {
    const free = await freeBytes(dir);
    if (free < needed) {
      throw new Error(
        `Not enough free space on ${dir}: ${megabytes(free)} free, ${megabytes(needed)} needed to back up and, ` +
          `on rollback, restore the ${megabytes(databaseBytes)} database. Nothing was changed.`,
      );
    }
  }
}

/**
 * @param {string} path
 * @returns {Promise<number>} the size, or 0 for a file that no longer exists
 */
async function sizeIfPresent(path) {
  try {
    return (await lstat(path)).size;
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return 0;
    throw error;
  }
}

/** @param {number} bytes */
const megabytes =(bytes) => `${Math.ceil(bytes / (1024 * 1024))} MB`;

/**
 * Deletes all but the newest `keep` backups (by the timestamp in the file name)
 * and copies left behind by an interrupted backup. The backup of the update that
 * just ran is never deleted.
 *
 * @param {string} backupDir
 * @param {number} keep
 * @param {string | null} protectedPath the backup of the update that just ran, if it made one
 * @returns {Promise<string[]>} paths of the deleted database backups
 */
export async function pruneBackups(backupDir, keep, protectedPath) {
  const names = await readdir(backupDir);
  const stamped = names
    .flatMap((name) => {
      const stamp = BACKUP_NAME.exec(name)?.[1];
      return stamp ? [{ name, stamp }] : [];
    })
    .sort((a, b) => b.stamp.localeCompare(a.stamp) || b.name.localeCompare(a.name));

  const expired = stamped
    .slice(keep)
    .map(({ name }) => join(backupDir, name))
    .filter((path) => path !== protectedPath);
  for (const path of expired) {
    await rm(path, { force: true });
    for (const suffix of SIDECAR_SUFFIXES) await rm(path + suffix, { force: true });
  }
  for (const name of names.filter((entry) => LEFTOVER_PARTIAL.test(entry))) await rm(join(backupDir, name), { force: true });
  return expired;
}
