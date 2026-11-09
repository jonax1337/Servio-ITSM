import { mkdtemp, mkdir, readdir, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countWithinSnapshot, evaluateVerification, verifyBackupDirectory } from "@/scripts/backup/verify.mjs";
import { createBackup } from "@/scripts/backup/create.mjs";
import { extractTarGz, inspectTarGz, isSafeEntryName, writeTarGz } from "@/scripts/backup/tar.mjs";
import { listBackups, pruneBackups, readJson } from "@/scripts/backup/layout.mjs";

const healthy = {
  integrity: ["ok"],
  database: { expectedSha256: "abc", actualSha256: "abc" },
  copyCounts: { Ticket: 10, AuditLog: 50 },
  liveBefore: { Ticket: 10, AuditLog: 50 },
  liveAfter: { Ticket: 10, AuditLog: 51 },
  migrations: { expected: ["m1", "m2"], actual: ["m1", "m2"] },
  archive: {
    expected: { sha256: "x", files: 2, bytes: 30 },
    actual: { sha256: "x", files: 2, bytes: 30, unsupported: [] as string[] },
  },
  missingKeys: [] as string[],
};

describe("countWithinSnapshot", () => {
  it("accepts a count between the live counts around the snapshot", () => {
    expect(countWithinSnapshot(50, 50, 51)).toBe(true);
    expect(countWithinSnapshot(51, 50, 51)).toBe(true);
    expect(countWithinSnapshot(49, 50, 48)).toBe(true); // rows deleted meanwhile
  });

  it("refuses a count outside them", () => {
    expect(countWithinSnapshot(0, 50, 50)).toBe(false);
    expect(countWithinSnapshot(52, 50, 51)).toBe(false);
  });

  it("accepts anything without live counts", () => {
    expect(countWithinSnapshot(3, undefined, undefined)).toBe(true);
  });
});

describe("evaluateVerification", () => {
  it("passes a healthy backup", () => {
    expect(evaluateVerification(healthy)).toEqual({ ok: true, problems: [], warnings: [] });
  });

  it("fails on integrity_check messages", () => {
    const verdict = evaluateVerification({ ...healthy, integrity: ["*** in database main ***", "Page 4 is never used"] });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems[0]).toMatch(/integrity check failed/);
  });

  it("fails when the copy no longer matches its checksum", () => {
    expect(evaluateVerification({ ...healthy, database: { expectedSha256: "abc", actualSha256: "def" } }).ok).toBe(false);
  });

  it("fails when a core table lost rows or is missing", () => {
    const verdict = evaluateVerification({ ...healthy, copyCounts: { AuditLog: 50, Ticket: 3 } });
    expect(verdict.problems).toEqual(["Row count of Ticket differs: copy 3, live 10–10"]);
    expect(evaluateVerification({ ...healthy, copyCounts: { AuditLog: 50 } }).problems).toEqual(["Table Ticket is missing from the copy"]);
  });

  it("fails on migrations that differ from the manifest", () => {
    expect(evaluateVerification({ ...healthy, migrations: { expected: ["m1", "m2"], actual: ["m1"] } }).ok).toBe(false);
  });

  it("fails on an unreadable, altered or incomplete archive", () => {
    expect(evaluateVerification({ ...healthy, archive: { ...healthy.archive, actual: null, error: "unexpected end of file" } }).problems).toEqual([
      "Upload archive is not readable: unexpected end of file",
    ]);
    expect(evaluateVerification({ ...healthy, archive: { ...healthy.archive, actual: { ...healthy.archive.actual, sha256: "y" } } }).ok).toBe(false);
    expect(evaluateVerification({ ...healthy, archive: { ...healthy.archive, actual: { ...healthy.archive.actual, files: 1 } } }).ok).toBe(false);
    expect(
      evaluateVerification({ ...healthy, archive: { ...healthy.archive, actual: { ...healthy.archive.actual, unsupported: ["link"] } } }).ok,
    ).toBe(false);
  });

  it("only warns about files the database references but the disk lacked", () => {
    const keys = Array.from({ length: 12 }, (_, i) => `2026/11/k${i}`);
    const verdict = evaluateVerification({ ...healthy, missingKeys: keys });
    expect(verdict.ok).toBe(true);
    expect(verdict.warnings[0]).toMatch(/^12 file\(s\) referenced/);
    expect(verdict.warnings[0]).toMatch(/and 2 more$/);
  });

  it("skips the archive and live comparison when there is nothing to compare", () => {
    expect(evaluateVerification({ ...healthy, archive: null, liveBefore: null, liveAfter: null, copyCounts: {} }).ok).toBe(true);
  });
});

describe("backup on disk (tar.gz + SQLite)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "servio-backup-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function seedDatabase(file: string) {
    const db = new DatabaseSync(file);
    db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE "Ticket" (id INTEGER PRIMARY KEY, title TEXT);
      CREATE TABLE "Attachment" (id TEXT PRIMARY KEY, storageKey TEXT);
      CREATE TABLE _prisma_migrations (id TEXT, migration_name TEXT, finished_at TEXT, rolled_back_at TEXT);
      INSERT INTO "Ticket" (title) VALUES ('a'), ('b'), ('c');
      INSERT INTO "Attachment" VALUES ('1', '2026/11/one.txt'), ('2', '2026/11/gone.txt');
      INSERT INTO _prisma_migrations VALUES ('x', '20260101000000_init', '2026-01-01', NULL);
    `);
    return db; // left open: the WAL is part of what the snapshot must capture
  }

  it("round-trips files through tar.gz, including long names and empty files", async () => {
    const src = path.join(dir, "src");
    const long = `2026/11/${"n".repeat(150)}.bin`;
    await mkdir(path.join(src, "2026", "11"), { recursive: true });
    await writeFile(path.join(src, "2026", "11", "one.txt"), "hello");
    await writeFile(path.join(src, ...long.split("/")), Buffer.alloc(70_000, 7));
    await writeFile(path.join(src, "2026", "11", "empty"), "");
    const archive = path.join(dir, "u.tar.gz");
    const written = await writeTarGz(archive, [
      { name: "2026/11/one.txt", abs: path.join(src, "2026", "11", "one.txt") },
      { name: long, abs: path.join(src, ...long.split("/")) },
      { name: "2026/11/empty", abs: path.join(src, "2026", "11", "empty") },
      { name: "2026/11/vanished", abs: path.join(src, "nope") },
    ]);
    expect(written).toMatchObject({ files: 3, bytes: 70_005, skipped: ["2026/11/vanished"] });

    const inspected = await inspectTarGz(archive);
    expect([...inspected.names].sort()).toEqual(["2026/11/empty", "2026/11/one.txt", long].sort());
    expect(inspected.sha256).toBe(written.sha256);

    const out = path.join(dir, "out");
    expect(await extractTarGz(archive, out)).toEqual({ files: 3, bytes: 70_005 });
    expect(await readFile(path.join(out, "2026", "11", "one.txt"), "utf8")).toBe("hello");
    expect((await stat(path.join(out, ...long.split("/")))).size).toBe(70_000);
  });

  it("detects a truncated archive", async () => {
    const file = path.join(dir, "f.txt");
    await writeFile(file, Buffer.alloc(200_000, 1));
    const archive = path.join(dir, "u.tar.gz");
    await writeTarGz(archive, [{ name: "f.txt", abs: file }]);
    await truncate(archive, Math.floor((await stat(archive)).size / 2));
    await expect(inspectTarGz(archive)).rejects.toThrow();
  });

  it("refuses unsafe archive paths", () => {
    for (const bad of ["../etc/passwd", "/abs", "a/../../b", "C:/x", "a\\b", "", "a//b"]) expect(isSafeEntryName(bad)).toBe(false);
    for (const good of ["2026/11/x.pdf", "a", "dir/"]) expect(isSafeEntryName(good)).toBe(true);
  });

  it("creates, verifies and publishes a backup; retention keeps the newest", async () => {
    const dbFile = path.join(dir, "servio.db");
    const live = await seedDatabase(dbFile);
    const uploads = path.join(dir, "uploads");
    await mkdir(path.join(uploads, "2026", "11"), { recursive: true });
    await writeFile(path.join(uploads, "2026", "11", "one.txt"), "attachment");
    await writeFile(path.join(uploads, "2026", "11", "upload.tmp"), "in flight");
    const backupDir = path.join(dir, "backups");

    const first = await createBackup({ dbFile, uploadDir: uploads, backupDir, appVersion: "9.9.9", now: new Date("2026-11-18T02:30:00Z") });
    live.exec("INSERT INTO \"Ticket\" (title) VALUES ('d')");
    const second = await createBackup({ dbFile, uploadDir: uploads, backupDir, now: new Date("2026-11-19T02:30:00Z") });
    live.close();

    expect(first.name).toBe("servio-backup-20261118T023000Z");
    expect(first.verification.ok).toBe(true);
    expect(first.uploadsFiles).toBe(1); // the *.tmp upload in flight is skipped
    expect(first.verification.warnings[0]).toMatch(/2026\/11\/gone\.txt/);
    expect(first.verification.checks).toMatchObject({ integrity_check: ["ok"], row_counts: { Ticket: 3, Attachment: 2 } });
    expect(second.verification.checks).toMatchObject({ row_counts: { Ticket: 4 } });

    const copy = new DatabaseSync(path.join(second.path, "servio.db"), { readOnly: true });
    expect(copy.prepare('SELECT count(*) AS n FROM "Ticket"').get()).toMatchObject({ n: 4 });
    copy.close();

    const manifest = await readJson(path.join(first.path, "manifest.json"));
    expect(manifest).toMatchObject({ app_version: "9.9.9", migrations: ["20260101000000_init"], uploads: { files: 1 } });
    expect((await verifyBackupDirectory(first.path, manifest ?? {})).ok).toBe(true);

    const listed = await listBackups(backupDir);
    expect(listed.map((b) => [b.name, b.verified])).toEqual([
      [second.name, true],
      [first.name, true],
    ]);
    const pruned = await pruneBackups(backupDir, { keepCount: 1, keepDays: 0 }, { now: new Date("2026-11-20T00:00:00Z") });
    expect(pruned.deleted).toEqual([first.name]);
    expect((await readdir(backupDir)).filter((n) => !n.startsWith("."))).toEqual([second.name]);
  });

  it("detects a backup that was altered after it was made", async () => {
    const dbFile = path.join(dir, "servio.db");
    (await seedDatabase(dbFile)).close();
    const backup = await createBackup({ dbFile, uploadDir: null, backupDir: path.join(dir, "backups") });
    const manifest = (await readJson(path.join(backup.path, "manifest.json"))) ?? {};
    const db = new DatabaseSync(path.join(backup.path, "servio.db"));
    db.exec("DELETE FROM \"Ticket\"");
    db.close();
    const verdict = await verifyBackupDirectory(backup.path, manifest);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toContain("Database copy does not match its recorded checksum");
  });

  it("refuses a backup directory inside the upload directory and leaves nothing behind", async () => {
    const dbFile = path.join(dir, "servio.db");
    (await seedDatabase(dbFile)).close();
    const uploads = path.join(dir, "uploads");
    await mkdir(uploads);
    await expect(createBackup({ dbFile, uploadDir: uploads, backupDir: path.join(uploads, "backups") })).rejects.toThrow(/inside the upload directory/);
    await expect(createBackup({ dbFile, uploadDir: null, backupDir: path.join(dir, "b"), freeBytes: async () => 1 })).rejects.toThrow(/Not enough free space/);
    expect(await readdir(path.join(dir, "b"))).toEqual([]);
  });
});
