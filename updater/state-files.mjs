// Shared state directory helpers (contract: SERVIO_STATE_DIR, see updater/README.md).
// JSON files are written atomically and durably; readers treat a missing or
// half-written file as absent. The directory is writable by the app, so nothing
// here follows symlinks.
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { assertRealDirectory, inPinnedDirectory, readRegularFile, writeNewFileDurably } from "./safe-fs.mjs";

/** Cap for `request.json`, the journal and the ledger: each is at most a few kilobytes. */
export const MAX_SMALL_JSON_BYTES = 64 * 1024;
/** Cap for `status.json`, which carries the step log. */
export const MAX_STATUS_BYTES = 1024 * 1024;

/**
 * @param {string} stateDir
 */
export function statePaths(stateDir) {
  const updaterDir = join(stateDir, "updater");
  return {
    stateDir,
    updaterDir,
    request: join(updaterDir, "request.json"),
    status: join(updaterDir, "status.json"),
    heartbeat: join(updaterDir, "heartbeat.json"),
  };
}

/**
 * @param {string} file
 * @param {number} maxBytes
 * @returns {Promise<any | null>} parsed JSON, or null when absent/unparseable
 * @throws {import("./safe-fs.mjs").UnsafeFileError} for symlinks, special files and oversize files
 */
export async function readJsonFile(file, maxBytes) {
  const text = await readRegularFile(file, maxBytes);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * Writes `<file>.tmp-<uuid>` (exclusively created, fsynced) and renames it over
 * `file`, then fsyncs the directory. `guardedDirs` lead from a trusted directory
 * down to the file's directory; none of them may be a symlink, and on Linux the
 * write cannot be redirected by swapping one of them mid-write.
 *
 * @param {string} file
 * @param {unknown} value
 * @param {string[]} [guardedDirs] defaults to the file's directory
 */
export async function writeJsonAtomic(file, value, guardedDirs = [dirname(file)]) {
  if (guardedDirs.at(-1) !== dirname(file)) throw new Error(`${file} is not inside ${guardedDirs.at(-1)}`);
  await inPinnedDirectory(guardedDirs, async (dir) => {
    const target = join(dir, basename(file));
    const temporary = `${target}.tmp-${randomUUID()}`;
    try {
      await writeNewFileDurably(temporary, `${JSON.stringify(value, null, 2)}\n`, 0o644);
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  });
}

/**
 * Creates `dir` if needed and verifies it is a real directory.
 *
 * @param {string} dir
 */
export async function ensureDirectory(dir) {
  await mkdir(dir, { recursive: true });
  await assertRealDirectory(dir);
}
