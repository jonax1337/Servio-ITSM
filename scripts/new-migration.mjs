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
// with --create-only and renames it to a stamp after the newest one. See docs/development.md.
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../prisma/migrations/", import.meta.url));
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

function main() {
  const name = process.argv[2];
  if (!name || !/^[a-z][a-z0-9_]{1,60}$/.test(name)) {
    console.error("Usage: pnpm db:migrate:new <snake_case_name>   (letters, digits and _, starting with a letter)");
    process.exit(1);
  }
  const before = new Set(readdirSync(MIGRATIONS));
  // The name is validated above, so interpolating it into the command line is safe.
  execSync(`pnpm exec prisma migrate dev --create-only --skip-seed --name ${name}`, { stdio: "inherit" });
  const created = readdirSync(MIGRATIONS).filter((e) => !before.has(e) && STAMP.test(e));
  if (created.length !== 1) throw new Error(`Expected one new migration folder, found ${created.length}`);
  // With nothing to change Prisma still writes a migration, containing only a comment.
  const sql = readFileSync(join(MIGRATIONS, created[0], "migration.sql"), "utf8");
  if (sql.split(String.fromCharCode(10)).every((line) => line.trim() === "" || line.trim().startsWith("--"))) {
    rmSync(join(MIGRATIONS, created[0]), { recursive: true });
    console.log("The schema already matches the migrations - nothing to create.");
    return;
  }
  const target = nextMigrationName([...before], name);
  if (target !== created[0]) {
    if (existsSync(join(MIGRATIONS, target))) throw new Error(`${target} already exists`);
    renameSync(join(MIGRATIONS, created[0]), join(MIGRATIONS, target));
  }
  console.log(`\nCreated prisma/migrations/${target}\nReview it, then apply it with: pnpm db:migrate`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
