import { CronExpressionParser } from "cron-parser";
import { isValidTimeZone } from "@/lib/oncall-rules";
import { BACKUP_RUN_STALE_MS } from "@/scripts/backup/layout.mjs";

export { BACKUP_HEARTBEAT_MS, BACKUP_RUN_STALE_MS } from "@/scripts/backup/layout.mjs";

/**
 * Pure rules of the built-in backup (lib/backup.ts): the schedule, staleness of
 * a running backup and the monitoring payload. No database, no filesystem.
 */

/** AppSetting keys (Settings › Backups); each falls back to the env variable of the same name. */
export const BACKUP_SETTING = {
  enabled: "BACKUP_ENABLED",
  schedule: "BACKUP_SCHEDULE",
  timezone: "BACKUP_TIMEZONE",
  keepCount: "BACKUP_RETENTION_COUNT",
  keepDays: "BACKUP_RETENTION_DAYS",
  includeUploads: "BACKUP_INCLUDE_UPLOADS",
} as const;

export const DEFAULT_BACKUP_SCHEDULE = "02:30";
export const DEFAULT_BACKUP_TIMEZONE = "UTC";
export const DEFAULT_BACKUP_KEEP_COUNT = 7;
export const DEFAULT_BACKUP_KEEP_DAYS = 14;
/** Scheduled backups at most once an hour: each run copies the whole database and the uploads. */
export const MIN_BACKUP_INTERVAL_MS = 60 * 60_000;
/** Hard limit for one backup process. */
export const BACKUP_TIMEOUT_MS = 6 * 60 * 60_000;
/** After a verified manual backup, Back up now waits this long: each run copies everything again. */
export const MANUAL_BACKUP_COOLDOWN_MS = 15 * 60_000;

/**
 * Failure classes of a backup run (BackupRun.errorCode). The monitoring API
 * reports only these; the full message stays in Settings › Backups. The first
 * five come from the backup process (scripts/backup/create.mjs).
 */
export const BACKUP_ERROR_CODES = [
  "database_missing",
  "invalid_configuration",
  "insufficient_space",
  "verification_failed",
  "backup_failed",
  "timeout",
  "process_failed",
  "interrupted",
] as const;
export type BackupErrorCode = (typeof BACKUP_ERROR_CODES)[number];

/** A code reported by the backup process, or `backup_failed` for anything unknown. */
export function normalizeBackupErrorCode(raw: unknown): BackupErrorCode {
  return BACKUP_ERROR_CODES.find((code) => code === raw) ?? "backup_failed";
}

/**
 * Milliseconds until Back up now is allowed again (0 = now), counted from the
 * start of the newest verified manual backup.
 */
export function manualBackupCooldownLeft(lastManualSuccessAt: Date | null, now: Date): number {
  if (!lastManualSuccessAt) return 0;
  return Math.max(0, lastManualSuccessAt.getTime() + MANUAL_BACKUP_COOLDOWN_MS - now.getTime());
}

const DAILY_TIME = /^(\d{1,2}):(\d{2})$/;

export type ScheduleResult = { ok: true; cron: string } | { ok: false; error: string };

/**
 * The cron expression for a backup schedule: a daily time `HH:MM`, or a
 * five-field cron expression. Empty means the default (daily at 02:30).
 * Schedules that fire more often than hourly are refused.
 */
export function parseBackupSchedule(raw: string | null | undefined): ScheduleResult {
  const input = (raw ?? "").trim() || DEFAULT_BACKUP_SCHEDULE;
  const daily = DAILY_TIME.exec(input);
  let cron: string;
  if (daily) {
    const hour = Number(daily[1]);
    const minute = Number(daily[2]);
    if (hour > 23 || minute > 59) return { ok: false, error: "Use a time between 00:00 and 23:59." };
    cron = `${minute} ${hour} * * *`;
  } else {
    if (input.split(/\s+/).length !== 5) {
      return { ok: false, error: "Enter a daily time (HH:MM) or a cron expression with five fields." };
    }
    cron = input;
  }
  try {
    const it = CronExpressionParser.parse(cron, { currentDate: new Date(Date.UTC(2026, 0, 1)), tz: "UTC" });
    // Probe a stretch of runs: the shortest gap must not undercut the minimum interval.
    let previous = it.next().toDate().getTime();
    for (let i = 0; i < 48; i++) {
      const next = it.next().toDate().getTime();
      if (next - previous < MIN_BACKUP_INTERVAL_MS) return { ok: false, error: "Backups can run at most once an hour." };
      previous = next;
    }
  } catch {
    return { ok: false, error: "Enter a daily time (HH:MM) or a cron expression with five fields." };
  }
  return { ok: true, cron };
}

/** The configured time zone when it is a valid IANA name, else UTC. */
export function normalizeBackupTimeZone(raw: string | null | undefined): string {
  const zone = (raw ?? "").trim();
  return zone && isValidTimeZone(zone) ? zone : DEFAULT_BACKUP_TIMEZONE;
}

/** The first scheduled run strictly after `after`, or null for an invalid schedule. */
export function nextBackupAt(cron: string, timezone: string, after: Date): Date | null {
  try {
    return CronExpressionParser.parse(cron, { currentDate: after, tz: normalizeBackupTimeZone(timezone) }).next().toDate();
  } catch {
    return null;
  }
}

/**
 * Whether a scheduled backup is due: the first occurrence after the last
 * scheduled run (or, before any run, after `anchor`, the time the scheduler
 * started) has passed. A missed run (server down at the scheduled time) is
 * caught up once, not repeated.
 */
export function isBackupDue(cron: string, timezone: string, lastScheduledAt: Date | null, anchor: Date, now: Date): boolean {
  const next = nextBackupAt(cron, timezone, lastScheduledAt ?? anchor);
  return next !== null && next.getTime() <= now.getTime();
}

/** A RUNNING backup whose heartbeat stopped: the process that ran it is gone. */
export function isBackupRunStale(heartbeatAt: Date, now: Date): boolean {
  return now.getTime() - heartbeatAt.getTime() > BACKUP_RUN_STALE_MS;
}

type RunFacts = {
  status: string;
  trigger: string;
  startedAt: Date;
  finishedAt: Date | null;
  verified: boolean;
  databaseBytes: number | null;
  uploadsBytes: number | null;
  uploadsFiles: number | null;
  errorCode: string | null;
  name: string | null;
};

export type LatestBackupInput = {
  latest: RunFacts | null;
  lastSuccess: RunFacts | null;
  enabled: boolean;
  supported: boolean;
  schedule: string;
  timezone: string;
  nextRunAt: Date | null;
  now: Date;
};

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const ageSeconds = (d: Date | null | undefined, now: Date) => (d ? Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000)) : null);
const sizeOf = (run: RunFacts | null) =>
  run && (run.databaseBytes !== null || run.uploadsBytes !== null) ? (run.databaseBytes ?? 0) + (run.uploadsBytes ?? 0) : null;

/**
 * The monitoring view of the backups (GET /api/v1/system/backups/latest):
 * the newest run, and the newest verified one, with ages in seconds so an
 * external monitor can alert on age or failure without date math.
 */
export function latestBackupPayload(input: LatestBackupInput) {
  const { latest, lastSuccess, now } = input;
  return {
    status: latest?.status ?? "NONE",
    trigger: latest?.trigger ?? null,
    verified: latest?.verified ?? false,
    started_at: iso(latest?.startedAt),
    finished_at: iso(latest?.finishedAt),
    age_seconds: ageSeconds(latest?.finishedAt, now),
    size_bytes: sizeOf(latest),
    database_bytes: latest?.databaseBytes ?? null,
    uploads_bytes: latest?.uploadsBytes ?? null,
    uploads_files: latest?.uploadsFiles ?? null,
    name: latest?.name ?? null,
    error_code: latest?.status === "FAILED" ? normalizeBackupErrorCode(latest.errorCode) : null,
    last_success_at: iso(lastSuccess?.finishedAt),
    last_success_age_seconds: ageSeconds(lastSuccess?.finishedAt, now),
    last_success_size_bytes: sizeOf(lastSuccess),
    enabled: input.enabled,
    supported: input.supported,
    schedule: input.schedule,
    timezone: input.timezone,
    next_run_at: input.enabled && input.supported ? iso(input.nextRunAt) : null,
  };
}

/** The retention values an admin may enter (Settings › Backups). */
export function parseRetentionInput(countRaw: string, daysRaw: string): { ok: true; keepCount: number; keepDays: number } | { ok: false; error: string } {
  const count = countRaw.trim() === "" ? DEFAULT_BACKUP_KEEP_COUNT : Number(countRaw);
  const days = daysRaw.trim() === "" ? DEFAULT_BACKUP_KEEP_DAYS : Number(daysRaw);
  if (!Number.isInteger(count) || count < 1 || count > 1000) return { ok: false, error: "Keep between 1 and 1000 backups." };
  if (!Number.isInteger(days) || days < 0 || days > 3650) return { ok: false, error: "Keep backups for 0 to 3650 days." };
  return { ok: true, keepCount: count, keepDays: days };
}
