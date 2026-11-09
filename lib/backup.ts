import { execFile } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { getBoolSetting, getNumberSetting, getSetting } from "@/lib/settings";
import { notifyAdmins, writeAudit } from "@/lib/audit";
import { APP_VERSION, type BackupTrigger } from "@/lib/constants";
import { statePath, writeJsonAtomic } from "@/lib/state-dir";
import {
  BACKUP_HEARTBEAT_MS,
  BACKUP_SETTING,
  BACKUP_TIMEOUT_MS,
  DEFAULT_BACKUP_KEEP_COUNT,
  DEFAULT_BACKUP_KEEP_DAYS,
  DEFAULT_BACKUP_SCHEDULE,
  isBackupDue,
  isBackupRunStale,
  manualBackupCooldownLeft,
  nextBackupAt,
  normalizeBackupErrorCode,
  normalizeBackupTimeZone,
  parseBackupSchedule,
} from "@/lib/backup-rules";
import { APP_HEARTBEAT_FILE, listBackups, normalizeRetention, sqliteFileFromUrl } from "@/scripts/backup/layout.mjs";

/**
 * The built-in backup: on a schedule (lib/ticks/backup.ts) or on demand
 * (Settings › Backups), a child process (scripts/backup/run.mjs) takes a
 * snapshot of the SQLite database and archives the upload directory,
 * verifies both and applies retention. This module owns the BackupRun rows,
 * the lock (one RUNNING row at a time), audit entries and admin notices.
 * Server-only (Prisma, node:child_process).
 */

export type BackupConfig = {
  /** False when DATABASE_URL is not a SQLite file (PostgreSQL deployments back up with their own tools). */
  supported: boolean;
  dbFile: string | null;
  backupDir: string;
  /** Null when uploads are excluded or stored by a non-filesystem driver. */
  uploadDir: string | null;
  enabled: boolean;
  /** As entered (HH:MM or cron); `cron` is the parsed expression, null when invalid. */
  schedule: string;
  cron: string | null;
  timezone: string;
  keepCount: number;
  keepDays: number;
  includeUploads: boolean;
};

const SCRIPT = path.join(process.cwd(), "scripts", "backup", "run.mjs");
/** The scheduler's start: before the first scheduled run, the schedule counts from here. */
const PROCESS_STARTED_AT = new Date();
/** At most this much of the backup process's error output is kept on a failed run. */
const MAX_ERROR_CHARS = 2000;

const g = globalThis as unknown as { __servioBackupRunning?: boolean };

/** The backup directory: env only (a path on the server is not something to edit in the browser). */
export function backupDirectory(): string {
  // A runtime path outside the build: keep Turbopack from tracing the project for it.
  return path.resolve(/* turbopackIgnore: true */ process.env.BACKUP_DIR?.trim() || ".backups");
}

export async function readBackupConfig(): Promise<BackupConfig> {
  const dbFile = sqliteFileFromUrl(process.env.DATABASE_URL, path.resolve("prisma"));
  const [enabled, scheduleRaw, timezoneRaw, keepCount, keepDays, includeUploads] = await Promise.all([
    getBoolSetting(BACKUP_SETTING.enabled, true),
    getSetting(BACKUP_SETTING.schedule, DEFAULT_BACKUP_SCHEDULE),
    getSetting(BACKUP_SETTING.timezone),
    getNumberSetting(BACKUP_SETTING.keepCount, DEFAULT_BACKUP_KEEP_COUNT),
    getNumberSetting(BACKUP_SETTING.keepDays, DEFAULT_BACKUP_KEEP_DAYS),
    getBoolSetting(BACKUP_SETTING.includeUploads, true),
  ]);
  const schedule = scheduleRaw ?? DEFAULT_BACKUP_SCHEDULE;
  const parsed = parseBackupSchedule(schedule);
  const retention = normalizeRetention({ keepCount, keepDays });
  const fsStorage = (process.env.STORAGE_DRIVER ?? "fs") === "fs";
  return {
    supported: dbFile !== null,
    dbFile,
    backupDir: backupDirectory(),
    uploadDir: includeUploads && fsStorage ? path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR ?? "./.uploads") : null,
    enabled,
    schedule,
    cron: parsed.ok ? parsed.cron : null,
    timezone: normalizeBackupTimeZone(timezoneRaw),
    keepCount: retention.keepCount,
    keepDays: retention.keepDays,
    includeUploads,
  };
}

/** Keeps the app's liveness file fresh so the restore script can refuse while the app runs. */
export function writeAppHeartbeat(now = new Date()): void {
  try {
    writeJsonAtomic(statePath(APP_HEARTBEAT_FILE), { at: now.toISOString(), pid: process.pid, version: APP_VERSION });
  } catch (e) {
    console.warn("[servio:backup] could not write the app heartbeat:", e instanceof Error ? e.message : e);
  }
}

/** Removes the liveness file on a clean shutdown (a killed process leaves it to go stale). */
export function removeAppHeartbeat(): void {
  try {
    rmSync(statePath(APP_HEARTBEAT_FILE), { force: true });
  } catch {
    /* best effort */
  }
}

/** Marks RUNNING rows whose process stopped refreshing them as FAILED. */
export async function failStaleBackupRuns(now = new Date()): Promise<number> {
  const running = await db.backupRun.findMany({ where: { status: "RUNNING" }, select: { id: true, heartbeatAt: true } });
  let failed = 0;
  for (const run of running) {
    if (!isBackupRunStale(run.heartbeatAt, now)) continue;
    const res = await db.backupRun.updateMany({
      where: { id: run.id, status: "RUNNING" },
      data: {
        status: "FAILED",
        finishedAt: now,
        error: "Interrupted: the process running this backup stopped (restart or crash).",
        errorCode: "interrupted",
      },
    });
    failed += res.count;
  }
  return failed;
}

type ChildResult = {
  ok?: boolean;
  name?: string;
  database_bytes?: number;
  uploads_bytes?: number | null;
  uploads_files?: number | null;
  verification?: { ok?: boolean; problems?: string[]; warnings?: string[]; checks?: Record<string, unknown> } | null;
  pruned?: string[];
  partials_removed?: string[];
  prune_error?: string;
  error?: string;
  error_code?: string;
};

/** Runs scripts/backup/run.mjs for a claimed run and returns its JSON result (a failure result when it crashed). */
function runBackupProcess(runId: string, trigger: string, config: BackupConfig): Promise<ChildResult> {
  const args = [
    SCRIPT,
    "--json",
    "--run-id",
    runId,
    "--trigger",
    trigger,
    "--db",
    config.dbFile ?? "",
    "--backup-dir",
    config.backupDir,
    "--keep-count",
    String(config.keepCount),
    "--keep-days",
    String(config.keepDays),
    "--app-version",
    APP_VERSION,
    ...(config.uploadDir ? ["--uploads", config.uploadDir] : ["--no-uploads"]),
  ];
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      args,
      { timeout: BACKUP_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const last = String(stdout).trim().split(/\r?\n/).pop() ?? "";
        try {
          const parsed = JSON.parse(last) as ChildResult;
          if (parsed && typeof parsed === "object") return resolve(parsed);
        } catch {
          /* fall through: the process died before it printed its result */
        }
        const reason = error?.killed ? "The backup process timed out and was stopped." : error?.message ?? "The backup process ended without a result.";
        resolve({
          ok: false,
          error: `${reason} ${String(stderr).trim().slice(-MAX_ERROR_CHARS)}`.trim(),
          error_code: error?.killed ? "timeout" : "process_failed",
        });
      },
    );
  });
}

export type StartResult = { ok: true; runId: string } | { ok: false; error: string };

/**
 * Claims the backup lock by creating a RUNNING row. Refused while another
 * backup runs (in this process or, per its fresh heartbeat, in another one),
 * and for a manual backup within the cooldown after the last verified one.
 */
export async function startBackupRun(trigger: BackupTrigger, userId: string | null, config: BackupConfig): Promise<StartResult> {
  if (!config.supported) return { ok: false, error: "The built-in backup supports SQLite databases only." };
  if (g.__servioBackupRunning) return { ok: false, error: "A backup is already running." };
  if (trigger === "MANUAL") {
    const lastManual = await db.backupRun.findFirst({
      where: { trigger: "MANUAL", status: "SUCCESS" },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true },
    });
    if (manualBackupCooldownLeft(lastManual?.startedAt ?? null, new Date()) > 0) {
      return { ok: false, error: "A manual backup was made less than 15 minutes ago. Try again later." };
    }
  }
  await failStaleBackupRuns();
  const run = await db.$transaction(async (tx) => {
    const running = await tx.backupRun.findFirst({ where: { status: "RUNNING" }, select: { id: true } });
    if (running) return null;
    return tx.backupRun.create({ data: { status: "RUNNING", trigger, triggeredById: userId } });
  });
  if (!run) return { ok: false, error: "A backup is already running." };
  return { ok: true, runId: run.id };
}

/**
 * Executes a claimed run to the end: the backup process, the BackupRun row,
 * pruned rows, the audit entry and (for a failed scheduled run) the admin notice.
 */
export async function executeBackupRun(runId: string, trigger: BackupTrigger, config: BackupConfig): Promise<void> {
  g.__servioBackupRunning = true;
  const heartbeat = setInterval(() => {
    void db.backupRun.updateMany({ where: { id: runId, status: "RUNNING" }, data: { heartbeatAt: new Date() } }).catch(() => {});
  }, BACKUP_HEARTBEAT_MS);
  if (typeof heartbeat.unref === "function") heartbeat.unref();
  try {
    const result = await runBackupProcess(runId, trigger, config);
    const now = new Date();
    const verified = result.ok === true && result.verification?.ok === true;
    const details = {
      checks: result.verification?.checks ?? null,
      problems: result.verification?.problems ?? [],
      warnings: result.verification?.warnings ?? [],
      pruned: result.pruned ?? [],
      partials_removed: result.partials_removed ?? [],
      prune_error: result.prune_error ?? null,
      backup_dir: config.backupDir,
      uploads_included: config.uploadDir !== null,
    };
    const run = await db.backupRun.update({
      where: { id: runId },
      data: {
        status: verified ? "SUCCESS" : "FAILED",
        finishedAt: now,
        heartbeatAt: now,
        name: result.name ?? null,
        databaseBytes: result.database_bytes ?? null,
        uploadsBytes: result.uploads_bytes ?? null,
        uploadsFiles: result.uploads_files ?? null,
        verified,
        details: JSON.stringify(details),
        error: verified ? null : (result.error ?? "Unknown error").slice(0, MAX_ERROR_CHARS),
        errorCode: verified ? null : normalizeBackupErrorCode(result.error_code),
      },
    });
    if (details.pruned.length > 0) {
      await db.backupRun.updateMany({ where: { name: { in: details.pruned }, prunedAt: null }, data: { prunedAt: now } });
    }
    await writeAudit({
      userId: null,
      action: "UPDATE",
      entity: "BackupRun",
      entityId: run.id,
      summary: verified
        ? `Backup ${run.name} verified and stored${details.pruned.length ? ` (retention removed ${details.pruned.join(", ")})` : ""}`
        : `Backup failed: ${run.error}`,
    });
    if (!verified) {
      console.error(`[servio:backup] FAILED: ${run.error}`);
      if (run.trigger === "SCHEDULE") {
        await notifyAdmins({
          type: "BACKUP_FAILED",
          title: "Scheduled backup failed",
          body: `${(run.error ?? "Unknown error").slice(0, 300)} See Settings > Backups.`,
        });
      }
    } else {
      console.log(`[servio:backup] ${run.name} verified (${details.warnings.length} warning(s))`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[servio:backup] run error:", message);
    await db.backupRun
      .updateMany({
        where: { id: runId, status: "RUNNING" },
        data: { status: "FAILED", finishedAt: new Date(), error: message.slice(0, MAX_ERROR_CHARS), errorCode: "backup_failed" },
      })
      .catch(() => {});
  } finally {
    clearInterval(heartbeat);
    g.__servioBackupRunning = false;
  }
}

/** Scheduler entry: runs a scheduled backup when one is due. Never throws. */
export async function runScheduledBackupIfDue(now = new Date()): Promise<void> {
  const config = await readBackupConfig();
  await failStaleBackupRuns(now);
  if (!config.enabled || !config.supported || !config.cron) return;
  const lastScheduled = await db.backupRun.findFirst({
    where: { trigger: "SCHEDULE" },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });
  if (!isBackupDue(config.cron, config.timezone, lastScheduled?.startedAt ?? null, PROCESS_STARTED_AT, now)) return;
  const started = await startBackupRun("SCHEDULE", null, config);
  if (!started.ok) return; // another backup is running; the schedule tries again on the next tick
  await executeBackupRun(started.runId, "SCHEDULE", config);
}

/** Everything Settings › Backups and the monitoring endpoint show. */
export async function backupOverview(now = new Date()) {
  const config = await readBackupConfig();
  const [latest, lastSuccess, runs, lastScheduled] = await Promise.all([
    db.backupRun.findFirst({ orderBy: { startedAt: "desc" } }),
    db.backupRun.findFirst({ where: { status: "SUCCESS" }, orderBy: { startedAt: "desc" } }),
    db.backupRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 30,
      include: { triggeredBy: { select: { name: true, email: true } } },
    }),
    db.backupRun.findFirst({ where: { trigger: "SCHEDULE" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
  ]);
  // Same anchor as the scheduler; an overdue run starts on the next tick, so it shows as "now".
  const due = config.cron ? nextBackupAt(config.cron, config.timezone, lastScheduled?.startedAt ?? PROCESS_STARTED_AT) : null;
  const nextRunAt = due && due < now ? now : due;
  return { config, latest, lastSuccess, runs, nextRunAt };
}

/** The backups on disk (count and total size), for the settings page. Empty when the directory is unreadable. */
export async function backupsOnDisk(backupDir: string): Promise<{ count: number; bytes: number }> {
  try {
    const backups = await listBackups(backupDir);
    return { count: backups.length, bytes: backups.reduce((sum, b) => sum + b.bytes, 0) };
  } catch {
    return { count: 0, bytes: 0 };
  }
}
