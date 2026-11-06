// File access that refuses symlinks and special files. The shared /data volume
// is writable by the (internet-facing) app, so every path under it is attacker
// controlled: a planted symlink must never be followed, and reads are size-capped.
import { constants } from "node:fs";
import { lstat, open, rm } from "node:fs/promises";

const COPY_CHUNK_BYTES = 1024 * 1024;

/** `O_NOFOLLOW` does not exist on Windows; the `lstat` checks cover that platform. */
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

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
 * Opens without following a final symlink and re-checks the opened handle,
 * which closes the window between the `lstat` and the `open`.
 *
 * @param {string} path
 * @returns {Promise<import("node:fs/promises").FileHandle>}
 */
async function openRegularFile(path) {
  await regularFileExists(path);
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | NOFOLLOW);
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
 * existing file or symlink at the destination is never written through.
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
