// Shared state directory helpers (contract: SERVIO_STATE_DIR, see updater/README.md).
// JSON files are written atomically; readers treat a missing or half-written file as absent.
// The directory is writable by the app, so nothing here follows symlinks.
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertRealDirectory, readRegularFile } from "./safe-fs.mjs";

/** Cap for `request.json` and the journal: both are a few hundred bytes. */
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
 * Writes `<file>.tmp-<uuid>` (exclusively created) and renames it over `file`.
 * `guardedDirs` must all be real directories (no symlinks) at write time.
 *
 * @param {string} file
 * @param {unknown} value
 * @param {string[]} [guardedDirs] defaults to the file's directory
 */
export async function writeJsonAtomic(file, value, guardedDirs = [dirname(file)]) {
  for (const dir of guardedDirs) await assertRealDirectory(dir);
  const temporary = `${file}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o644 });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
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
