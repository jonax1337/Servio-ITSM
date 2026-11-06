import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The shared state directory (SERVIO_STATE_DIR): the file contract between the
 * app, proxy.ts and the updater sidecar (docs/updates.md). Import-light on
 * purpose, proxy.ts reads it too; nothing here touches the database.
 */

const DEFAULT_STATE_DIR = ".servio-state";

export function stateDir(): string {
  return path.resolve(process.env.SERVIO_STATE_DIR?.trim() || DEFAULT_STATE_DIR);
}

/** Absolute path of a file inside the state directory. */
export function statePath(...segments: string[]): string {
  return path.join(stateDir(), ...segments);
}

/**
 * The parsed JSON of `file`, or null when it is missing or not valid JSON (a
 * writer that is not atomic may be caught half-way). Callers validate the shape.
 */
export function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Write `value` as JSON via `<file>.tmp-<pid>` + rename, so readers never see a partial file. */
export function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}
