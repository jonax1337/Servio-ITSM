// "Restore test light" for a backup: the copy must open, pass PRAGMA
// integrity_check, hold as many rows in the core tables as the live database
// did around the snapshot, and the upload archive must read back completely.
// The decision is a pure function (evaluateVerification) so it can be tested;
// verifyBackupDirectory gathers the facts.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { DB_FILE_NAME, UPLOADS_FILE_NAME } from "./layout.mjs";
import { appliedMigrations, countRows, integrityCheck, openReadOnly, referencedStorageKeys } from "./sqlite.mjs";
import { inspectTarGz } from "./tar.mjs";

/** How many missing blob keys a report lists by name. */
const MISSING_KEYS_SHOWN = 10;

/**
 * @typedef {Record<string, number>} RowCounts
 * @typedef {{ sha256: string, files: number, bytes: number }} ArchiveFacts
 * @typedef {{
 *   integrity: string[],
 *   database: { expectedSha256: string | null, actualSha256: string },
 *   copyCounts: RowCounts,
 *   liveBefore?: RowCounts | null,
 *   liveAfter?: RowCounts | null,
 *   migrations?: { expected: string[], actual: string[] } | null,
 *   archive?: { expected: ArchiveFacts, actual: (ArchiveFacts & { unsupported: string[] }) | null, error?: string | null } | null,
 *   missingKeys?: string[],
 * }} VerificationFacts
 * @typedef {{ ok: boolean, problems: string[], warnings: string[] }} VerificationVerdict
 */

/**
 * Whether the row count of the copy is plausible for a snapshot taken between
 * two live counts: it must lie between them (inclusive). Rows written and
 * deleted around the snapshot move the live count, not the snapshot.
 *
 * @param {number} copy
 * @param {number | undefined} before
 * @param {number | undefined} after
 * @returns {boolean}
 */
export function countWithinSnapshot(copy, before, after) {
  const known = [before, after].filter((n) => typeof n === "number");
  if (known.length === 0) return true;
  return copy >= Math.min(...known) && copy <= Math.max(...known);
}

/**
 * Decides whether a backup passed verification.
 *
 * @param {VerificationFacts} facts
 * @returns {VerificationVerdict}
 */
export function evaluateVerification(facts) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const warnings = [];

  if (!(facts.integrity.length === 1 && facts.integrity[0] === "ok")) {
    problems.push(`Database integrity check failed: ${facts.integrity.slice(0, 5).join("; ") || "no result"}`);
  }
  if (facts.database.expectedSha256 && facts.database.expectedSha256 !== facts.database.actualSha256) {
    problems.push("Database copy does not match its recorded checksum");
  }

  const before = facts.liveBefore ?? null;
  const after = facts.liveAfter ?? null;
  if (before || after) {
    const tables = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    for (const table of [...tables].sort()) {
      const copy = facts.copyCounts[table];
      if (copy === undefined) {
        problems.push(`Table ${table} is missing from the copy`);
        continue;
      }
      if (!countWithinSnapshot(copy, before?.[table], after?.[table])) {
        const live = [before?.[table], after?.[table]].filter((n) => n !== undefined).join("–");
        problems.push(`Row count of ${table} differs: copy ${copy}, live ${live}`);
      }
    }
  }

  if (facts.migrations) {
    const expected = facts.migrations.expected.join("\n");
    const actual = facts.migrations.actual.join("\n");
    if (expected !== actual) problems.push("Applied migrations of the copy differ from the manifest");
  }

  if (facts.archive) {
    const { expected, actual, error } = facts.archive;
    if (error || !actual) {
      problems.push(`Upload archive is not readable: ${error ?? "unknown error"}`);
    } else {
      if (actual.sha256 !== expected.sha256) problems.push("Upload archive does not match its recorded checksum");
      if (actual.files !== expected.files || actual.bytes !== expected.bytes) {
        problems.push(
          `Upload archive holds ${actual.files} files (${actual.bytes} bytes), expected ${expected.files} files (${expected.bytes} bytes)`,
        );
      }
      if (actual.unsupported.length > 0) problems.push(`Upload archive contains unsupported entries: ${actual.unsupported.slice(0, 5).join(", ")}`);
    }
  }

  const missing = facts.missingKeys ?? [];
  if (missing.length > 0) {
    const shown = missing.slice(0, MISSING_KEYS_SHOWN).join(", ");
    const more = missing.length > MISSING_KEYS_SHOWN ? ` and ${missing.length - MISSING_KEYS_SHOWN} more` : "";
    warnings.push(`${missing.length} file(s) referenced by the database are not in the upload archive (missing on disk already?): ${shown}${more}`);
  }

  return { ok: problems.length === 0, problems, warnings };
}

/**
 * @param {string} file
 * @returns {Promise<string>} hex sha256 of the file
 */
export async function sha256File(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), async function (source) {
    for await (const chunk of source) hash.update(chunk);
  });
  return hash.digest("hex");
}

/**
 * @param {unknown} value
 * @returns {RowCounts | null}
 */
function asCounts(value) {
  if (!value || typeof value !== "object") return null;
  /** @type {RowCounts} */
  const counts = {};
  for (const [key, n] of Object.entries(value)) if (typeof n === "number") counts[key] = n;
  return counts;
}

/**
 * Verifies the backup in `dir` against its manifest, and against live row
 * counts when given (at backup time; a restore verifies without them).
 *
 * @param {string} dir
 * @param {Record<string, unknown>} manifest
 * @param {{ liveBefore?: RowCounts | null, liveAfter?: RowCounts | null }} [live]
 * @returns {Promise<VerificationVerdict & { checks: Record<string, unknown> }>}
 */
export async function verifyBackupDirectory(dir, manifest, live = {}) {
  const database = /** @type {Record<string, unknown>} */ (manifest.database ?? {});
  const uploads = /** @type {Record<string, unknown> | null} */ (manifest.uploads ?? null);
  const dbFile = join(dir, DB_FILE_NAME);

  const actualSha256 = await sha256File(dbFile);
  const db = openReadOnly(dbFile);
  let integrity;
  let copyCounts;
  let migrations;
  let keys;
  try {
    integrity = integrityCheck(db);
    copyCounts = countRows(db);
    migrations = appliedMigrations(db);
    keys = uploads ? referencedStorageKeys(db) : [];
  } finally {
    db.close();
  }

  /** @type {VerificationFacts["archive"]} */
  let archive = null;
  /** @type {string[]} */
  let missingKeys = [];
  if (uploads) {
    const expected = {
      sha256: String(uploads.sha256 ?? ""),
      files: Number(uploads.files ?? -1),
      bytes: Number(uploads.content_bytes ?? -1),
    };
    try {
      const inspected = await inspectTarGz(join(dir, String(uploads.file ?? UPLOADS_FILE_NAME)));
      archive = { expected, actual: { sha256: inspected.sha256, files: inspected.files, bytes: inspected.bytes, unsupported: inspected.unsupported } };
      missingKeys = keys.filter((key) => !inspected.names.has(key));
    } catch (error) {
      archive = { expected, actual: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const expectedMigrations = Array.isArray(manifest.migrations) ? manifest.migrations.map(String) : null;
  const verdict = evaluateVerification({
    integrity,
    database: { expectedSha256: typeof database.sha256 === "string" ? database.sha256 : null, actualSha256 },
    copyCounts,
    liveBefore: live.liveBefore ?? asCounts(manifest.live_counts_before),
    liveAfter: live.liveAfter ?? asCounts(manifest.live_counts_after),
    migrations: expectedMigrations ? { expected: expectedMigrations, actual: migrations } : null,
    archive,
    missingKeys,
  });
  return {
    ...verdict,
    checks: {
      integrity_check: integrity.slice(0, 5),
      row_counts: copyCounts,
      migrations: migrations.length,
      archive_files: archive?.actual?.files ?? null,
      missing_blobs: missingKeys.length,
    },
  };
}
