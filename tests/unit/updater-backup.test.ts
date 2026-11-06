import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackup, pruneBackups, restoreBackup } from "../../updater/backup.mjs";

let root: string;
let dbFile: string;
let backupDir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "servio-backup-"));
  dbFile = join(root, "servio.db");
  backupDir = join(root, "backups");
  await mkdir(backupDir);
});
afterEach(() => rm(root, { recursive: true, force: true }));

const touch = (name: string) => writeFile(join(backupDir, name), "x");

describe("createBackup / restoreBackup", () => {
  it("copies the database and its WAL, named after version and UTC time", async () => {
    await writeFile(dbFile, "db");
    await writeFile(`${dbFile}-wal`, "wal");

    const backup = await createBackup({ dbFile, backupDir, fromVersion: "0.2.0", at: new Date("2026-11-06T10:20:30.456Z") });

    expect(backup.path).toBe(join(backupDir, "servio-0.2.0-20261106T102030Z.db"));
    expect(backup.sidecars).toEqual(["-wal"]);
    expect((await readFile(backup.path)).toString()).toBe("db");
    expect((await readFile(`${backup.path}-wal`)).toString()).toBe("wal");
  });

  it("includes a rollback journal left by a killed process, so the backup is not torn (finding H1)", async () => {
    await writeFile(dbFile, "db");
    await writeFile(`${dbFile}-journal`, "hot-journal");

    const backup = await createBackup({ dbFile, backupDir, fromVersion: "0.2.0", at: new Date("2026-11-06T10:20:30Z") });

    expect(backup.sidecars).toEqual(["-journal"]);
    expect((await readFile(`${backup.path}-journal`)).toString()).toBe("hot-journal");
  });

  it("restores a rollback journal that existed at backup time and removes one that did not", async () => {
    await writeFile(dbFile, "db");
    await writeFile(`${dbFile}-journal`, "hot-journal");
    const withJournal = await createBackup({ dbFile, backupDir, fromVersion: "0.2.0", at: new Date("2026-11-06T10:00:00Z") });
    await rm(`${dbFile}-journal`);
    const withoutJournal = await createBackup({ dbFile, backupDir, fromVersion: "0.2.0", at: new Date("2026-11-06T10:00:01Z") });

    await writeFile(`${dbFile}-journal`, "journal-of-the-new-version");
    await restoreBackup(dbFile, withoutJournal);
    await expect(stat(`${dbFile}-journal`)).rejects.toMatchObject({ code: "ENOENT" });

    await restoreBackup(dbFile, withJournal);
    expect((await readFile(`${dbFile}-journal`)).toString()).toBe("hot-journal");
  });

  it("never leaves a file under a backup's final name when the backup fails part-way (finding L3)", async () => {
    await writeFile(dbFile, "db");
    await writeFile(`${dbFile}-wal`, "wal");
    const at = new Date("2026-11-06T10:00:00Z");
    // A file already holds the database's final name: publishing it fails after the WAL was copied.
    await writeFile(join(backupDir, "servio-0.2.0-20261106T100000Z.db"), "older");

    await expect(createBackup({ dbFile, backupDir, fromVersion: "0.2.0", at })).rejects.toMatchObject({ code: "EEXIST" });

    expect(await readdir(backupDir)).toEqual(["servio-0.2.0-20261106T100000Z.db"]);
    expect((await readFile(join(backupDir, "servio-0.2.0-20261106T100000Z.db"))).toString()).toBe("older");
  });

  it("keeps an unknown or unsafe version out of the file name", async () => {
    await writeFile(dbFile, "db");

    const unknown = await createBackup({ dbFile, backupDir, fromVersion: null, at: new Date("2026-11-06T10:00:00Z") });
    const unsafe = await createBackup({ dbFile, backupDir, fromVersion: "../x y", at: new Date("2026-11-06T10:00:01Z") });

    expect(unknown.path).toContain("servio-unknown-");
    expect(basename(unsafe.path)).toMatch(/^servio-.._x_y-/);
    expect(await readdir(backupDir)).toHaveLength(2);
  });

  it("fails with the file name when the database is missing", async () => {
    await expect(createBackup({ dbFile, backupDir, fromVersion: "0.2.0", at: new Date() })).rejects.toThrow(
      `Database file ${dbFile} does not exist`,
    );
  });

  it("restores files and removes WAL/SHM files that did not exist at backup time", async () => {
    await writeFile(dbFile, "db");
    const backup = await createBackup({ dbFile, backupDir, fromVersion: "0.2.0", at: new Date() });
    await writeFile(dbFile, "migrated");
    await writeFile(`${dbFile}-wal`, "new-wal");
    await writeFile(`${dbFile}-shm`, "new-shm");

    await restoreBackup(dbFile, backup);

    expect((await readFile(dbFile)).toString()).toBe("db");
    await expect(stat(`${dbFile}-wal`)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(`${dbFile}-shm`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restores a WAL that existed at backup time", async () => {
    await writeFile(dbFile, "db");
    await writeFile(`${dbFile}-wal`, "wal");
    const backup = await createBackup({ dbFile, backupDir, fromVersion: "0.2.0", at: new Date() });
    await rm(`${dbFile}-wal`);

    await restoreBackup(dbFile, backup);

    expect((await readFile(`${dbFile}-wal`)).toString()).toBe("wal");
  });
});

describe("pruneBackups", () => {
  it("keeps the newest BACKUP_KEEP backups by timestamp, regardless of version or name order", async () => {
    await touch("servio-0.1.0-20261101T000000Z.db");
    await touch("servio-0.9.0-20261102T000000Z.db");
    await touch("servio-0.10.0-20261103T000000Z.db");
    await touch("servio-0.11.0-20261104T000000Z.db");
    await touch("servio-1.0.0-rc.1-20261105T000000Z.db");

    const removed = await pruneBackups(backupDir, 3, join(backupDir, "unrelated.db"));

    expect(removed.map((path) => path.split(/[\\/]/).pop())).toEqual([
      "servio-0.9.0-20261102T000000Z.db",
      "servio-0.1.0-20261101T000000Z.db",
    ]);
    expect((await readdir(backupDir)).sort()).toEqual([
      "servio-0.10.0-20261103T000000Z.db",
      "servio-0.11.0-20261104T000000Z.db",
      "servio-1.0.0-rc.1-20261105T000000Z.db",
    ]);
  });

  it("removes the WAL/SHM files of expired backups and leaves unrelated files alone", async () => {
    await touch("servio-0.1.0-20261101T000000Z.db");
    await touch("servio-0.1.0-20261101T000000Z.db-wal");
    await touch("servio-0.1.0-20261101T000000Z.db-shm");
    await touch("servio-0.2.0-20261102T000000Z.db");
    await touch("notes.txt");

    await pruneBackups(backupDir, 1, join(backupDir, "unrelated.db"));

    expect((await readdir(backupDir)).sort()).toEqual(["notes.txt", "servio-0.2.0-20261102T000000Z.db"]);
  });

  it("removes copies an interrupted backup left behind", async () => {
    await touch("servio-0.1.0-20261101T000000Z.db");
    await touch("servio-0.2.0-20261102T000000Z.db.partial-0b5c7a52-1d1e-4c39-9c1a-6c0d1d1f0b8e");

    await pruneBackups(backupDir, 5, join(backupDir, "unrelated.db"));

    expect(await readdir(backupDir)).toEqual(["servio-0.1.0-20261101T000000Z.db"]);
  });

  it("deletes nothing when there are fewer backups than the limit", async () => {
    await touch("servio-0.1.0-20261101T000000Z.db");

    expect(await pruneBackups(backupDir, 5, join(backupDir, "unrelated.db"))).toEqual([]);
    expect(await readdir(backupDir)).toHaveLength(1);
  });
});
