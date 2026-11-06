// SQLite backup, restore and rotation. The container is stopped before
// `createBackup` runs, so copying the files is a consistent snapshot.
// The database directory is writable by the app, so every source is checked to
// be a regular file and no destination is ever written through a symlink.
import { randomUUID } from "node:crypto";
import { readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { assertRealDirectory, copyRegularFile, regularFileExists } from "./safe-fs.mjs";

const SIDECAR_SUFFIXES = ["-wal", "-shm"];
const BACKUP_NAME = /^servio-.+-(\d{8}T\d{6}Z)\.db$/;

/**
 * @typedef {{ path: string, sidecars: string[] }} Backup
 *   `sidecars` are the suffixes (`-wal`, `-shm`) that existed next to the database.
 */

/**
 * Checks that the database (and any WAL/SHM next to it) can be backed up.
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

  await copyRegularFile(dbFile, path);
  for (const suffix of sidecars) await copyRegularFile(dbFile + suffix, path + suffix);
  return { path, sidecars };
}

/**
 * Puts the backed-up files back and removes WAL/SHM files that did not exist
 * at backup time (they would otherwise be replayed onto the restored database).
 * Each file is copied to an exclusive temp file next to the target and renamed
 * over it, which replaces a planted symlink instead of writing through it.
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
 * Deletes all but the newest `keep` backups (by the timestamp in the file name).
 * The backup of the update that just ran is never deleted.
 *
 * @param {string} backupDir
 * @param {number} keep
 * @param {string} protectedPath
 * @returns {Promise<string[]>} paths of the deleted database backups
 */
export async function pruneBackups(backupDir, keep, protectedPath) {
  const stamped = (await readdir(backupDir))
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
  return expired;
}
