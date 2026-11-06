// File access that refuses symlinks and special files. The shared /data volume
// is writable by the (internet-facing) app, so every path under it is attacker
// controlled: a planted symlink must never be followed, a FIFO must never block
// a read, and reads are size-capped.
import { constants } from "node:fs";
import { lstat, open, rm } from "node:fs/promises";
import { basename, dirname } from "node:path";

const COPY_CHUNK_BYTES = 1024 * 1024;

// These flags do not exist on Windows (a development platform only); the
// `lstat` and `fstat` checks cover it there.
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
/** A FIFO swapped in after the `lstat` would otherwise block `open` until a writer appears. */
const NONBLOCK = constants.O_NONBLOCK ?? 0;
const DIRECTORY = constants.O_DIRECTORY ?? 0;
/**
 * On Linux `/proc/self/fd/<n>` names the directory that descriptor `n` was opened
 * on, even after its path has been renamed or replaced by a symlink: writing below
 * it behaves like `openat(2)`, which Node does not expose.
 */
const PINNED_DIRECTORIES = process.platform === "linux";

export class UnsafeFileError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "UnsafeFileError";
  }
}

/** @param {unknown} error @param {string} code */
const hasCode = (error, code) => /** @type {NodeJS.ErrnoException} */ (error)?.code === code;

/**
 * @param {string} path
 * @returns {Promise<import("node:fs").Stats | null>} null when the path does not exist
 */
async function lstatIfPresent(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

/**
 * @param {string} path
 * @returns {Promise<boolean>} whether a regular file exists at `path`
 * @throws {UnsafeFileError} when something else (symlink, directory, device) is there
 */
export async function regularFileExists(path) {
  const stats = await lstatIfPresent(path);
  if (!stats) return false;
  if (!stats.isFile()) throw new UnsafeFileError(`${path} is not a regular file (symlink or special file); refusing to use it`);
  return true;
}

/**
 * @param {string} dir
 * @throws {UnsafeFileError} when `dir` is missing, a symlink or not a directory
 */
export async function assertRealDirectory(dir) {
  const stats = await lstatIfPresent(dir);
  if (!stats?.isDirectory()) throw new UnsafeFileError(`${dir} is not a real directory (missing, symlink or file); refusing to use it`);
}

/**
 * Opens without following a final symlink and without blocking on a FIFO, then
 * re-checks the opened handle, which closes the window between the `lstat` and the `open`.
 *
 * @param {string} path
 * @returns {Promise<import("node:fs/promises").FileHandle>}
 */
async function openRegularFile(path) {
  await regularFileExists(path);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
  } catch (error) {
    if (hasCode(error, "ELOOP")) throw new UnsafeFileError(`${path} is a symbolic link; refusing to follow it`);
    throw error;
  }
  if (!(await handle.stat()).isFile()) {
    await handle.close();
    throw new UnsafeFileError(`${path} is not a regular file; refusing to use it`);
  }
  return handle;
}

/**
 * @param {string} path
 * @param {number} maxBytes
 * @returns {Promise<string | null>} file contents, or null when the file does not exist
 * @throws {UnsafeFileError} for symlinks, special files and files larger than `maxBytes`
 */
export async function readRegularFile(path, maxBytes) {
  if (!(await lstatIfPresent(path))) return null;
  const handle = await openRegularFile(path);
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) throw new UnsafeFileError(`${path} is larger than ${maxBytes} bytes; refusing to read it`);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Copies a regular file to a destination that must not exist yet (`wx`), so an
 * existing file or symlink at the destination is never written through. The copy
 * is flushed to disk before this resolves.
 *
 * @param {string} source
 * @param {string} destination
 */
export async function copyRegularFile(source, destination) {
  const input = await openRegularFile(source);
  try {
    const output = await open(destination, "wx", 0o600);
    try {
      const chunk = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
      for (;;) {
        const { bytesRead } = await input.read(chunk, 0, chunk.length, null);
        if (bytesRead === 0) break;
        for (let written = 0; written < bytesRead; ) {
          written += (await output.write(chunk, written, bytesRead - written)).bytesWritten;
        }
      }
      await output.sync();
    } catch (error) {
      await rm(destination, { force: true });
      throw error;
    } finally {
      await output.close();
    }
  } finally {
    await input.close();
  }
}

/**
 * Writes `contents` to a new file (`wx`) and flushes it to disk.
 *
 * @param {string} path
 * @param {string} contents
 * @param {number} mode
 */
export async function writeNewFileDurably(path, contents, mode) {
  const handle = await open(path, "wx", mode);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Runs `action` with a path to the last of `dirs` that keeps naming the directory
 * that was checked, even if an attacker swaps the path for a symlink meanwhile
 * (Linux). Each directory must be the parent of the next, and none may be a
 * symlink. The directory is fsynced afterwards, so renames done by `action` are durable.
 * Elsewhere `action` gets the plain path after `lstat` checks.
 *
 * @template T
 * @param {string[]} dirs e.g. ["/data/state", "/data/state/updater"]
 * @param {(dir: string) => Promise<T>} action
 * @returns {Promise<T>}
 * @throws {UnsafeFileError} when a directory is missing, a symlink or not a directory
 */
export async function inPinnedDirectory(dirs, action) {
  dirs.forEach((dir, index) => {
    if (index > 0 && dirname(dir) !== dirs[index - 1]) throw new Error(`${dir} is not directly inside ${dirs[index - 1]}`);
  });
  if (!PINNED_DIRECTORIES) {
    for (const dir of dirs) await assertRealDirectory(dir);
    return action(/** @type {string} */ (dirs.at(-1)));
  }

  let handle = await openRealDirectory(dirs[0], dirs[0]);
  try {
    for (const dir of dirs.slice(1)) {
      const child = await openRealDirectory(`/proc/self/fd/${handle.fd}/${basename(dir)}`, dir);
      await handle.close();
      handle = child;
    }
    const result = await action(`/proc/self/fd/${handle.fd}`);
    await handle.sync();
    return result;
  } finally {
    await handle.close();
  }
}

/**
 * Flushes a directory entry change (rename, link, unlink) in `dir` to disk.
 * A no-op where directories cannot be fsynced (Windows).
 *
 * @param {string} dir
 */
export async function syncDirectory(dir) {
  await inPinnedDirectory([dir], async () => {});
}

/**
 * @param {string} path what to open
 * @param {string} label the path to report
 */
async function openRealDirectory(path, label) {
  try {
    return await open(path, constants.O_RDONLY | DIRECTORY | NOFOLLOW);
  } catch (error) {
    if (["ELOOP", "ENOTDIR", "ENOENT"].some((code) => hasCode(error, code))) {
      throw new UnsafeFileError(`${label} is not a real directory (missing, symlink or file); refusing to use it`);
    }
    throw error;
  }
}
