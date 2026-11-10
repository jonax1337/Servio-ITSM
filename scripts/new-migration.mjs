#!/usr/bin/env node
// Creates the next Prisma migration with a name that sorts AFTER every migration already in
// prisma/migrations, then leaves applying it to `pnpm db:migrate`.
//
//   pnpm db:migrate:new <snake_case_name>
//
// Why not plain `prisma migrate dev --name x`? Prisma stamps the new folder with the wall clock.
// When the newest migration in the repo is dated later than your clock (migrations are
// numbered ahead of the calendar), the new one lands in the MIDDLE of the history. It was
// generated against the full current schema, so it already contains columns that later
// migrations add: the next `migrate dev` replays the history on its shadow database and fails
// with "duplicate column name" (or "drift detected"). This script creates the migration
// with a stamp after the newest one. See docs/development.md.
//
// The SQL comes from `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --script`
// (replayed on a throw-away shadow database). Unlike `migrate dev` this never prompts (e.g. when a
// unique constraint is added), and only the script on stdout is written - the output of pnpm or
// other tools can never end up in migration.sql. The result is validated before anything is written.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../prisma/migrations/", import.meta.url));
const SCHEMA = fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url));
const STAMP = /^(\d{14})_/;

/** `20261125103000` for a Date, in UTC (Prisma's folder prefix). */
export function stampOf(date) {
  return date.toISOString().replace(/\D/g, "").slice(0, 14);
}

function dateOfStamp(stamp) {
  const [, y, mo, d, h, mi, s] = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
}

/**
 * The folder name for a new migration: today's stamp, or one minute after the newest existing
 * migration when that is later (so the new one always sorts last). `existing` is the list of
 * folder names; entries without a stamp (migration_lock.toml) are ignored.
 */
export function nextMigrationName(existing, name, now = new Date()) {
  const stamps = existing.map((e) => STAMP.exec(e)?.[1]).filter(Boolean).sort();
  const newest = stamps.at(-1);
  let stamp = stampOf(now);
  if (newest && stamp <= newest) stamp = stampOf(new Date(dateOfStamp(newest).getTime() + 60_000));
  return `${stamp}_${name}`;
}

const SQL_START = /^(--|\/\*|(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|PRAGMA|BEGIN|COMMIT|SELECT|WITH|REPLACE)\b)/i;

/**
 * Checks the generated script and returns `{ ok, empty, reason }`. It must start with SQL (a comment
 * or a statement) - anything else, e.g. the "Already up to date" line of a package manager, means
 * foreign output got mixed in. `empty` is true when it holds only comments (nothing to migrate).
 */
export function validateMigrationSql(sql) {
  const lines = String(sql).replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.trim());
  const first = lines.find((l) => l !== "");
  if (first === undefined) return { ok: false, empty: true, reason: "the generated SQL is empty" };
  if (!SQL_START.test(first)) return { ok: false, empty: false, reason: `the SQL starts with non-SQL text: "${first.slice(0, 80)}"` };
  return { ok: true, empty: lines.every((l) => l === "" || l.startsWith("--")), reason: "" };
}

function fail(message) {
  console.error(`db:migrate:new: ${message}`);
  process.exit(1);
}

/** Runs the Prisma CLI directly through node (no pnpm/shell wrapper that could print into stdout). */
function generateSql() {
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  const shadowDir = mkdtempSync(join(tmpdir(), "servio-shadow-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        prismaCli, "migrate", "diff",
        "--from-migrations", MIGRATIONS,
        "--to-schema-datamodel", SCHEMA,
        "--shadow-database-url", `file:${join(shadowDir, "shadow.db").replaceAll("\\", "/")}`,
        "--script",
      ],
      { encoding: "utf8", env: { DATABASE_URL: "file:./dev.db", ...process.env }, stdio: ["ignore", "pipe", "inherit"] },
    );
    if (result.error || result.status !== 0) fail(`prisma migrate diff failed (exit ${result.status ?? "n/a"}${result.error ? `: ${result.error.message}` : ""})`);
    return result.stdout;
  } finally {
    rmSync(shadowDir, { recursive: true, force: true });
  }
}

function main() {
  const name = process.argv[2];
  if (!name || !/^[a-z][a-z0-9_]{1,60}$/.test(name)) fail("usage: pnpm db:migrate:new <snake_case_name>   (letters, digits and _, starting with a letter)");
  const target = nextMigrationName(readdirSync(MIGRATIONS), name);
  if (existsSync(join(MIGRATIONS, target))) fail(`${target} already exists`);
  const sql = generateSql();
  const check = validateMigrationSql(sql);
  if (!check.ok) fail(`refusing to write migration.sql: ${check.reason}`);
  if (check.empty) {
    console.log("The schema already matches the migrations - nothing to create.");
    return;
  }
  mkdirSync(join(MIGRATIONS, target));
  writeFileSync(join(MIGRATIONS, target, "migration.sql"), sql.endsWith("\n") ? sql : `${sql}\n`);
  console.log(`Created prisma/migrations/${target}\nReview it, then apply it with: pnpm db:migrate`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
