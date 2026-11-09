import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKUP_RUN_STALE_MS } from "@/scripts/backup/layout.mjs";
import { BackupLockedError, claimRun, finishRun, settleRestoredRuns, touchRun } from "@/scripts/backup/runs.mjs";

const MIGRATION = readFileSync(path.resolve("prisma/migrations/20261122100000_backup_runs/migration.sql"), "utf8");

describe("BackupRun rows written outside the app", () => {
  let dir: string;
  let dbFile: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "servio-backup-runs-"));
    dbFile = path.join(dir, "servio.db");
    const db = new DatabaseSync(dbFile);
    db.exec('CREATE TABLE "User" ("id" TEXT NOT NULL PRIMARY KEY)'); // the run table refers to it
    db.exec(MIGRATION);
    db.close();
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function rows() {
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      return db.prepare('SELECT * FROM "BackupRun" ORDER BY "startedAt"').all();
    } finally {
      db.close();
    }
  }

  function insertRunning(id: string, heartbeatAt: number) {
    const db = new DatabaseSync(dbFile);
    db.prepare(`INSERT INTO "BackupRun" ("id", "status", "trigger", "startedAt", "heartbeatAt", "createdAt") VALUES (?, 'RUNNING', 'SCHEDULE', ?, ?, ?)`).run(
      id,
      heartbeatAt,
      heartbeatAt,
      heartbeatAt,
    );
    db.close();
  }

  it("records a command-line run from RUNNING to its result, in the format Prisma reads", () => {
    const now = new Date("2026-11-19T10:00:00Z");
    const id = claimRun(dbFile, { trigger: "CLI", now });
    expect(rows()).toMatchObject([{ id, status: "RUNNING", trigger: "CLI", startedAt: now.getTime() }]);
    touchRun(dbFile, id as string);

    const done = new Date("2026-11-19T10:01:00Z");
    finishRun(
      dbFile,
      id as string,
      { ok: true, name: "servio-backup-20261119T100000Z", database_bytes: 4096, uploads_bytes: null, uploads_files: null, pruned: [] },
      done,
    );
    expect(rows()).toMatchObject([
      { id, status: "SUCCESS", verified: 1, finishedAt: done.getTime(), name: "servio-backup-20261119T100000Z", databaseBytes: 4096, error: null },
    ]);
  });

  it("records a failure with its error class and marks pruned backups", () => {
    const first = claimRun(dbFile, { trigger: "CLI" }) as string;
    finishRun(dbFile, first, { ok: true, name: "servio-backup-old", pruned: [] });
    const second = claimRun(dbFile, { trigger: "CLI" }) as string;
    finishRun(dbFile, second, { ok: false, error: "Not enough free space in /x", error_code: "insufficient_space", pruned: ["servio-backup-old"] });
    const [old, failed] = rows();
    expect(old.prunedAt).not.toBeNull();
    expect(failed).toMatchObject({ status: "FAILED", verified: 0, errorCode: "insufficient_space", error: "Not enough free space in /x" });
  });

  it("refuses while another backup runs, and takes over from a stale one", () => {
    const now = Date.now();
    insertRunning("busy", now);
    expect(() => claimRun(dbFile, { trigger: "CLI" })).toThrow(BackupLockedError);

    const db = new DatabaseSync(dbFile);
    db.prepare('UPDATE "BackupRun" SET "heartbeatAt" = ? WHERE "id" = ?').run(now - BACKUP_RUN_STALE_MS - 1000, "busy");
    db.close();
    const id = claimRun(dbFile, { trigger: "CLI" });
    expect(id).toBeTruthy();
    expect(rows().find((row) => row.id === "busy")).toMatchObject({ status: "FAILED", errorCode: "interrupted" });
  });

  it("does not record anything in a database without the run table", () => {
    const bare = path.join(dir, "old.db");
    new DatabaseSync(bare).close();
    expect(claimRun(bare, { trigger: "CLI" })).toBeNull();
    expect(settleRestoredRuns(bare, { runId: "x", name: "n", finishedAt: new Date(), databaseBytes: null, uploadsBytes: null, uploadsFiles: null })).toEqual({
      settled: 0,
      interrupted: 0,
    });
  });

  it("settles a restored snapshot: its own run verified, any other run in progress interrupted", () => {
    insertRunning("own", Date.now());
    insertRunning("other", Date.now());
    const finishedAt = new Date("2026-11-19T02:31:00Z");
    const result = settleRestoredRuns(dbFile, {
      runId: "own",
      name: "servio-backup-20261119T023000Z",
      finishedAt,
      databaseBytes: 1000,
      uploadsBytes: 500,
      uploadsFiles: 2,
    });
    expect(result).toEqual({ settled: 1, interrupted: 1 });
    const byId = Object.fromEntries(rows().map((row) => [row.id, row]));
    expect(byId.own).toMatchObject({ status: "SUCCESS", verified: 1, finishedAt: finishedAt.getTime(), name: "servio-backup-20261119T023000Z", uploadsFiles: 2 });
    expect(byId.other).toMatchObject({ status: "FAILED", errorCode: "interrupted" });
  });
});
