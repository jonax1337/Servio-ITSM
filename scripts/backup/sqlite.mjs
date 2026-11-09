// SQLite access for the built-in backup through Node's own `node:sqlite`
// (no native add-on, no Prisma engine): an online snapshot with VACUUM INTO,
// integrity checks and the row counts the verification compares.

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
const { DatabaseSync } = await import("node:sqlite");
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
 * Writes a consistent, compacted copy of the open database to `destination`
 * (which must not exist). VACUUM INTO reads inside one transaction, so the copy
 * is a snapshot even while the app keeps writing; WAL content is included.
 *
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string} destination
 */
export function vacuumInto(db, destination) {
  db.prepare("VACUUM INTO ?").run(destination);
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
