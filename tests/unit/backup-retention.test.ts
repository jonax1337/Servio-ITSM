import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  backupName,
  isInside,
  normalizeRetention,
  parseBackupName,
  selectExpiredBackups,
  sqliteFileFromUrl,
} from "@/scripts/backup/layout.mjs";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-30T03:00:00Z");
/** One backup per day for `days` days, newest first: 2026-11-29, -28, … */
const daily = (days: number) =>
  Array.from({ length: days }, (_, i) => {
    const createdAt = new Date(now.getTime() - (i + 1) * DAY);
    return { name: backupName(createdAt), createdAt };
  });

describe("backup names", () => {
  it("round-trips the creation time", () => {
    const at = new Date("2026-11-19T02:30:05.123Z");
    expect(backupName(at)).toBe("servio-backup-20261119T023005Z");
    expect(parseBackupName("servio-backup-20261119T023005Z")?.toISOString()).toBe("2026-11-19T02:30:05.000Z");
    expect(parseBackupName("servio-backup-20261119T023005Z-2")?.toISOString()).toBe("2026-11-19T02:30:05.000Z");
  });

  it("ignores names that are not backups", () => {
    expect(parseBackupName(".partial-servio-backup-20261119T023005Z-abc")).toBeNull();
    expect(parseBackupName("servio-0.5.0-20261119T023005Z.db")).toBeNull();
    expect(parseBackupName("servio-backup-2026")).toBeNull();
  });
});

describe("selectExpiredBackups", () => {
  it("keeps the newest N and everything younger than the day limit", () => {
    const backups = daily(20);
    const expired = selectExpiredBackups(backups, { keepCount: 7, keepDays: 14 }, now);
    // 1–13 days old: younger than 14 days. 14–20 days old: beyond both limits.
    expect(expired).toEqual(backups.slice(13).map((b) => b.name));
  });

  it("keeps by count only with 0 days", () => {
    const backups = daily(10);
    expect(selectExpiredBackups(backups, { keepCount: 3, keepDays: 0 }, now)).toEqual(backups.slice(3).map((b) => b.name));
  });

  it("keeps the newest N even when all of them are old", () => {
    const old = daily(40).slice(30); // 31–40 days old
    expect(selectExpiredBackups(old, { keepCount: 7, keepDays: 14 }, now)).toEqual(old.slice(7).map((b) => b.name));
  });

  it("never deletes a protected backup, and always keeps at least one", () => {
    const backups = daily(5);
    const expired = selectExpiredBackups(backups, { keepCount: 0, keepDays: 0 }, now, [backups[3].name]);
    expect(expired).toEqual([backups[1].name, backups[2].name, backups[4].name]);
  });

  it("orders by creation time, not by input order", () => {
    const backups = daily(4).reverse();
    expect(selectExpiredBackups(backups, { keepCount: 2, keepDays: 0 }, now)).toEqual([daily(4)[2].name, daily(4)[3].name]);
  });

  it("deletes nothing when there are fewer backups than the count", () => {
    expect(selectExpiredBackups(daily(3), { keepCount: 7, keepDays: 0 }, now)).toEqual([]);
    expect(selectExpiredBackups([], { keepCount: 7, keepDays: 14 }, now)).toEqual([]);
  });
});

describe("normalizeRetention", () => {
  it("clamps to sane bounds", () => {
    expect(normalizeRetention({ keepCount: 0, keepDays: -3 })).toEqual({ keepCount: 1, keepDays: 0 });
    expect(normalizeRetention({ keepCount: 5000, keepDays: 99999 })).toEqual({ keepCount: 1000, keepDays: 3650 });
    expect(normalizeRetention({ keepCount: Number.NaN, keepDays: undefined })).toEqual({ keepCount: 7, keepDays: 14 });
  });
});

describe("sqliteFileFromUrl", () => {
  const schemaDir = path.resolve("prisma");

  it("resolves relative paths against the schema directory, like Prisma", () => {
    expect(sqliteFileFromUrl("file:./dev.db", schemaDir)).toBe(path.join(schemaDir, "dev.db"));
    expect(sqliteFileFromUrl("file:dev.db?connection_limit=1", schemaDir)).toBe(path.join(schemaDir, "dev.db"));
  });

  it("keeps absolute paths", () => {
    expect(sqliteFileFromUrl("file:/data/servio.db", schemaDir)).toBe(path.resolve("/data/servio.db"));
  });

  it("returns null for other databases", () => {
    expect(sqliteFileFromUrl("postgresql://u:p@db:5432/servio", schemaDir)).toBeNull();
    expect(sqliteFileFromUrl("", schemaDir)).toBeNull();
    expect(sqliteFileFromUrl(undefined, schemaDir)).toBeNull();
  });
});

describe("isInside", () => {
  it("detects a backup directory inside the upload directory", () => {
    expect(isInside("/data/uploads", "/data/uploads/backups")).toBe(true);
    expect(isInside("/data/uploads", "/data/uploads")).toBe(true);
    expect(isInside("/data/uploads", "/data/backups")).toBe(false);
    expect(isInside("/data/uploads", "/data/uploads-old")).toBe(false);
  });
});
