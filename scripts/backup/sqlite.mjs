// SQLite access for the built-in backup through Node's own `node:sqlite`
// (no native add-on, no Prisma engine): an online snapshot with the SQLite
// backup API, integrity checks and the row counts the verification compares.
import { rm } from "node:fs/promises";

// Some Node releases flag node:sqlite as experimental on load; the warning is
// noise in the backup and restore output, so it is filtered for this import only.
const emitWarning = process.emitWarning;
process.emitWarning = /** @type {typeof process.emitWarning} */ (
  function (warning, ...args) {
    const type = typeof args[0] === "string" ? args[0] : /** @type {{ type?: string } | undefined} */ (args[0])?.type;
    if (type === "ExperimentalWarning" && String(warning).includes("SQLite")) return;
    return /** @type {(...a: unknown[]) => void} */ (emitWarning).call(process, warning, ...args);
  }
);
const sqlite = await import("node:sqlite");
const { DatabaseSync } = sqlite;
process.emitWarning = emitWarning;

/**
 * Core tables whose row counts the verification compares between the live
 * database and the copy. Tables missing from a database (older schema) are skipped.
 */
export const CORE_TABLES = [
  "User",
  "Group",
  "Ticket",
  "TicketComment",
  "Problem",
  "Change",
  "Asset",
  "Attachment",
  "Article",
  "AuditLog",
  "AppSetting",
  "ApiToken",
];

/** Wait this long for a writer's lock before giving up (ms). */
const BUSY_TIMEOUT_MS = 30_000;

/**
 * @param {string} file
 * @returns {import("node:sqlite").DatabaseSync}
 */
export function openReadOnly(file) {
  return new DatabaseSync(file, { readOnly: true, timeout: BUSY_TIMEOUT_MS });
}

/**
 * For the few rows a backup outside the app records itself (scripts/backup/runs.mjs).
 *
 * @param {string} file
 * @returns {import("node:sqlite").DatabaseSync}
 */
export function openWritable(file) {
  return new DatabaseSync(file, { timeout: BUSY_TIMEOUT_MS });
}

/**
 * Pages copied per step of the backup API. Each step holds the database's
 * SHARED lock only while it copies its pages (a few MB), so writers of the
 * running app get in between steps instead of waiting for the whole copy.
 */
export const SNAPSHOT_STEP_PAGES = 1024;
/** Each attempt that a write restarted copies this many times more pages per step. */
const SNAPSHOT_STEP_GROWTH = 4;
/** Attempts with steps; the one after them copies everything in one step (writers wait for it once). */
const SNAPSHOT_STEPPED_ATTEMPTS = 6;
/** Pause after the n-th restarted attempt: n times this, so a burst of writes can settle. */
const SNAPSHOT_RETRY_PAUSE_MS = 250;
/** A step size that covers any database: one step, one lock, like VACUUM INTO. */
const ALL_PAGES = 2 ** 30;

class SnapshotRestarted extends Error {}

/**
 * Writes a consistent copy of `sourceFile` to `destination` (which must not
 * exist) while the app keeps running.
 *
 * In rollback-journal mode a reader blocks every writer for as long as it
 * reads, so one long read (VACUUM INTO) would stall the app's writes for the
 * whole copy and make them fail with "database is locked" once the copy takes
 * longer than their busy timeout. The backup API copies in steps and releases
 * the lock in between. A write by another connection between two steps makes
 * SQLite restart the copy; then, after a growing pause, the next attempt uses
 * bigger steps (fewer gaps for a write to land in). Only under a constant
 * stream of writes do all stepped attempts restart; the last attempt then
 * copies in one step and writers wait for that copy once, as they would for
 * VACUUM INTO. Every finished attempt is a snapshot of one moment. Without the
 * backup API (older Node), VACUUM INTO is the fallback.
 *
 * @param {string} sourceFile
 * @param {string} destination
 * @param {{ stepPages?: number, log?: (line: string) => void }} [options]
 * @returns {Promise<{ method: "backup-api" | "vacuum-into", attempts: number }>}
 */
export async function snapshotDatabase(sourceFile, destination, { stepPages = SNAPSHOT_STEP_PAGES, log = () => {} } = {}) {
  const source = openReadOnly(sourceFile);
  try {
    if (typeof sqlite.backup !== "function") {
      source.prepare("VACUUM INTO ?").run(destination);
      return { method: "vacuum-into", attempts: 1 };
    }
    for (let attempt = 1; ; attempt++) {
      const rate = attempt > SNAPSHOT_STEPPED_ATTEMPTS ? ALL_PAGES : stepPages * SNAPSHOT_STEP_GROWTH ** (attempt - 1);
      let copiedBefore = 0;
      try {
        await sqlite.backup(source, destination, {
          rate,
          // Every step copies new pages; a restart starts counting from the first page again.
          progress: ({ totalPages, remainingPages }) => {
            const copied = totalPages - remainingPages;
            if (copied <= copiedBefore) throw new SnapshotRestarted();
            copiedBefore = copied;
          },
        });
        return { method: "backup-api", attempts: attempt };
      } catch (error) {
        await rm(destination, { force: true });
        if (!(error instanceof SnapshotRestarted)) throw error;
        log(`the database changed during the copy (attempt ${attempt}); retrying with larger steps`);
        await new Promise((resolve) => setTimeout(resolve, SNAPSHOT_RETRY_PAUSE_MS * attempt));
      }
    }
  } finally {
    source.close();
  }
}

/**
 * @param {import("node:sqlite").DatabaseSync} db
 * @returns {string[]} the messages of PRAGMA integrity_check (["ok"] when healthy)
 */
export function integrityCheck(db) {
  return db
    .prepare("PRAGMA integrity_check(100)")
    .all()
    .map((row) => String(Object.values(row)[0]));
}

/**
 * @param {import("node:sqlite").DatabaseSync} db
 * @returns {Set<string>}
 */
function tableNames(db) {
  return new Set(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name)),
  );
}

/** @param {string} name */
const quoteIdent = (name) => `"${name.replace(/"/g, '""')}"`;

/**
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string[]} [tables]
 * @returns {Record<string, number>} row count per existing table
 */
export function countRows(db, tables = CORE_TABLES) {
  const existing = tableNames(db);
  /** @type {Record<string, number>} */
  const counts = {};
  for (const table of tables) {
    if (!existing.has(table)) continue;
    const row = db.prepare(`SELECT count(*) AS n FROM ${quoteIdent(table)}`).get();
    counts[table] = Number(row?.n ?? 0);
  }
  return counts;
}

/**
 * @param {import("node:sqlite").DatabaseSync} db
 * @returns {string[]} the applied Prisma migrations, sorted (empty without a migrations table)
 */
export function appliedMigrations(db) {
  if (!tableNames(db).has("_prisma_migrations")) return [];
  return db
    .prepare(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name",
    )
    .all()
    .map((row) => String(row.migration_name));
}

/**
 * Every blob key the database references: the `storageKey` column of any table
 * that has one (attachments and the other stored files).
 *
 * @param {import("node:sqlite").DatabaseSync} db
 * @returns {string[]}
 */
export function referencedStorageKeys(db) {
  /** @type {string[]} */
  const keys = [];
  for (const table of tableNames(db)) {
    if (table.startsWith("sqlite_") || table.startsWith("_")) continue;
    const columns = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all().map((row) => String(row.name));
    if (!columns.includes("storageKey")) continue;
    for (const row of db.prepare(`SELECT "storageKey" AS k FROM ${quoteIdent(table)} WHERE "storageKey" IS NOT NULL AND "storageKey" <> ''`).all()) {
      keys.push(String(row.k));
    }
  }
  return keys;
}

/**
 * Tries to take the write lock on the live database without waiting. Fails
 * while another process is in the middle of a write; an idle app is not seen.
 *
 * @param {string} file
 * @returns {boolean} true when the lock could be taken (and was released again)
 */
export function canLockExclusively(file) {
  const db = new DatabaseSync(file, { timeout: 0 });
  try {
    db.exec("BEGIN EXCLUSIVE");
    db.exec("ROLLBACK");
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}
