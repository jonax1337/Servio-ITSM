import { describe, expect, it } from "vitest";
import {
  BACKUP_ERROR_CODES,
  BACKUP_RUN_STALE_MS,
  MANUAL_BACKUP_COOLDOWN_MS,
  isBackupDue,
  isBackupRunStale,
  latestBackupPayload,
  manualBackupCooldownLeft,
  nextBackupAt,
  normalizeBackupErrorCode,
  normalizeBackupTimeZone,
  parseBackupSchedule,
  parseRetentionInput,
} from "@/lib/backup-rules";

describe("parseBackupSchedule", () => {
  it("turns a daily time into a cron expression", () => {
    expect(parseBackupSchedule("02:30")).toEqual({ ok: true, cron: "30 2 * * *" });
    expect(parseBackupSchedule("7:05")).toEqual({ ok: true, cron: "5 7 * * *" });
  });

  it("uses the default (daily 02:30) for an empty value", () => {
    expect(parseBackupSchedule("")).toEqual({ ok: true, cron: "30 2 * * *" });
    expect(parseBackupSchedule(null)).toEqual({ ok: true, cron: "30 2 * * *" });
  });

  it("accepts five-field cron expressions", () => {
    expect(parseBackupSchedule("0 */6 * * *")).toEqual({ ok: true, cron: "0 */6 * * *" });
    expect(parseBackupSchedule("15 3 * * 1-5")).toEqual({ ok: true, cron: "15 3 * * 1-5" });
  });

  it("refuses invalid times and expressions", () => {
    expect(parseBackupSchedule("24:00").ok).toBe(false);
    expect(parseBackupSchedule("12:60").ok).toBe(false);
    expect(parseBackupSchedule("every night").ok).toBe(false);
    expect(parseBackupSchedule("0 0 * * * *").ok).toBe(false); // six fields (seconds) are not offered
    expect(parseBackupSchedule("99 2 * * *").ok).toBe(false);
  });

  it("refuses schedules that run more often than hourly", () => {
    expect(parseBackupSchedule("*/5 * * * *")).toEqual({ ok: false, error: "Backups can run at most once an hour." });
    expect(parseBackupSchedule("0,30 * * * *").ok).toBe(false);
    expect(parseBackupSchedule("0 * * * *").ok).toBe(true);
  });
});

describe("backup schedule timing", () => {
  const cron = "30 2 * * *";

  it("finds the next run in the configured time zone", () => {
    const next = nextBackupAt(cron, "America/New_York", new Date("2026-11-19T00:00:00Z"));
    expect(next?.toISOString()).toBe("2026-11-19T07:30:00.000Z"); // 02:30 EST = 07:30 UTC
    expect(nextBackupAt(cron, "UTC", new Date("2026-11-19T00:00:00Z"))?.toISOString()).toBe("2026-11-19T02:30:00.000Z");
  });

  it("falls back to UTC for an unknown time zone", () => {
    expect(normalizeBackupTimeZone("Mars/Base")).toBe("UTC");
    expect(normalizeBackupTimeZone("")).toBe("UTC");
    expect(normalizeBackupTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("is due once the occurrence after the last scheduled run has passed", () => {
    const last = new Date("2026-11-18T02:30:10Z");
    expect(isBackupDue(cron, "UTC", last, new Date(0), new Date("2026-11-19T02:29:00Z"))).toBe(false);
    expect(isBackupDue(cron, "UTC", last, new Date(0), new Date("2026-11-19T02:30:00Z"))).toBe(true);
  });

  it("catches a missed run up once, after a downtime", () => {
    const last = new Date("2026-11-15T02:30:10Z");
    expect(isBackupDue(cron, "UTC", last, new Date(0), new Date("2026-11-19T08:00:00Z"))).toBe(true);
  });

  it("before the first run waits for the schedule instead of backing up at boot", () => {
    const anchor = new Date("2026-11-19T10:00:00Z"); // scheduler started
    expect(isBackupDue(cron, "UTC", null, anchor, new Date("2026-11-19T10:01:00Z"))).toBe(false);
    expect(isBackupDue(cron, "UTC", null, anchor, new Date("2026-11-20T02:30:30Z"))).toBe(true);
  });

  it("treats a run whose heartbeat stopped as interrupted", () => {
    const now = new Date("2026-11-19T10:00:00Z");
    expect(isBackupRunStale(new Date(now.getTime() - 30_000), now)).toBe(false);
    expect(isBackupRunStale(new Date(now.getTime() - BACKUP_RUN_STALE_MS - 1), now)).toBe(true);
  });
});

describe("parseRetentionInput", () => {
  it("applies defaults for empty fields", () => {
    expect(parseRetentionInput("", "")).toEqual({ ok: true, keepCount: 7, keepDays: 14 });
  });

  it("accepts 0 days (count only) and refuses out-of-range values", () => {
    expect(parseRetentionInput("3", "0")).toEqual({ ok: true, keepCount: 3, keepDays: 0 });
    expect(parseRetentionInput("0", "5").ok).toBe(false);
    expect(parseRetentionInput("2.5", "5").ok).toBe(false);
    expect(parseRetentionInput("5", "-1").ok).toBe(false);
    expect(parseRetentionInput("5", "abc").ok).toBe(false);
  });
});

describe("latestBackupPayload", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  const base = { enabled: true, supported: true, schedule: "02:30", timezone: "UTC", nextRunAt: new Date("2026-11-20T02:30:00Z"), now };
  const run = (over: Partial<Parameters<typeof latestBackupPayload>[0]["latest"] & object>) => ({
    status: "SUCCESS",
    trigger: "SCHEDULE",
    startedAt: new Date("2026-11-19T02:30:00Z"),
    finishedAt: new Date("2026-11-19T02:31:00Z"),
    verified: true,
    databaseBytes: 1000,
    uploadsBytes: 500,
    uploadsFiles: 3,
    errorCode: null,
    name: "servio-backup-20261119T023000Z",
    ...over,
  });

  it("reports NONE before the first backup", () => {
    const payload = latestBackupPayload({ ...base, latest: null, lastSuccess: null });
    expect(payload).toMatchObject({ status: "NONE", verified: false, finished_at: null, age_seconds: null, size_bytes: null, last_success_age_seconds: null });
  });

  it("reports age and size of a verified backup in snake_case", () => {
    const latest = run({});
    const payload = latestBackupPayload({ ...base, latest, lastSuccess: latest });
    expect(payload).toMatchObject({
      status: "SUCCESS",
      verified: true,
      finished_at: "2026-11-19T02:31:00.000Z",
      age_seconds: 9.5 * 3600 - 60,
      size_bytes: 1500,
      last_success_age_seconds: 9.5 * 3600 - 60,
      next_run_at: "2026-11-20T02:30:00.000Z",
    });
  });

  it("keeps the last verified backup visible after a failure", () => {
    const success = run({ startedAt: new Date("2026-11-18T02:30:00Z"), finishedAt: new Date("2026-11-18T02:31:00Z") });
    const failed = run({ status: "FAILED", verified: false, errorCode: "insufficient_space", databaseBytes: null, uploadsBytes: null });
    const payload = latestBackupPayload({ ...base, latest: failed, lastSuccess: success });
    expect(payload).toMatchObject({
      status: "FAILED",
      verified: false,
      error_code: "insufficient_space",
      size_bytes: null,
      last_success_size_bytes: 1500,
    });
    expect(payload.last_success_age_seconds).toBe(33.5 * 3600 - 60);
  });

  it("reports only a coarse error class, never the message", () => {
    const failed = run({ status: "FAILED", verified: false, errorCode: "something new" });
    const payload = latestBackupPayload({ ...base, latest: failed, lastSuccess: null });
    expect(payload.error_code).toBe("backup_failed");
    expect(payload).not.toHaveProperty("error");
    expect(latestBackupPayload({ ...base, latest: run({}), lastSuccess: null }).error_code).toBeNull();
  });

  it("has no next run when scheduled backups are off or unsupported", () => {
    expect(latestBackupPayload({ ...base, enabled: false, latest: null, lastSuccess: null }).next_run_at).toBeNull();
    expect(latestBackupPayload({ ...base, supported: false, latest: null, lastSuccess: null }).next_run_at).toBeNull();
  });
});

describe("manualBackupCooldownLeft", () => {
  const now = new Date("2026-11-19T12:00:00Z");

  it("allows a manual backup without a previous one", () => {
    expect(manualBackupCooldownLeft(null, now)).toBe(0);
  });

  it("waits 15 minutes after the last verified manual backup", () => {
    expect(manualBackupCooldownLeft(new Date(now.getTime() - 60_000), now)).toBe(MANUAL_BACKUP_COOLDOWN_MS - 60_000);
    expect(manualBackupCooldownLeft(new Date(now.getTime() - MANUAL_BACKUP_COOLDOWN_MS), now)).toBe(0);
  });
});

describe("normalizeBackupErrorCode", () => {
  it("keeps known codes and folds anything else into backup_failed", () => {
    for (const code of BACKUP_ERROR_CODES) expect(normalizeBackupErrorCode(code)).toBe(code);
    expect(normalizeBackupErrorCode("/data/backups: EACCES")).toBe("backup_failed");
    expect(normalizeBackupErrorCode(null)).toBe("backup_failed");
  });
});
