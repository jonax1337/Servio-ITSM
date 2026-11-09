import { CronExpressionParser } from "cron-parser";
import { db } from "@/lib/db";
import { getSetting, getBoolSetting, getNumberSetting } from "@/lib/settings";
import { pollImap, purgeImap } from "@/lib/mail-inbound/imap";
import {
  DEFAULT_PROCESSED_FOLDER,
  IMAP_PROCESSED_ACTION_SETTING,
  IMAP_PROCESSED_FOLDER_SETTING,
  IMAP_RETENTION_DAYS_SETTING,
  parseDisposition,
  parseRetentionDays,
} from "@/lib/mail-inbound/disposition";
import { processInboundMail } from "@/lib/mail-inbound/process";
import { executeSyncRun } from "@/lib/sync-runner";
import { runSlaEscalation } from "@/lib/sla-escalation";
import { runInsightsTick } from "@/lib/ticks/ai-insights";
import { runSlaNudgeTick } from "@/lib/ticks/sla-nudges";
import { runContractsTick } from "@/lib/ticks/contracts";
import { runMaintenanceTick } from "@/lib/ticks/maintenance";
import { runUpdateCheckTick } from "@/lib/ticks/update-check";
import { runRecurringTicketsTick } from "@/lib/ticks/recurring-tickets";
import { runAutoCloseTick } from "@/lib/ticks/auto-close";
import type { InboundConfig } from "@/lib/mail-inbound/types";

/**
 * Tiny in-process scheduler. Started once per server instance from
 * instrumentation.ts. Runs independent ticks: the inbound-mail poll, the
 * cron-driven sync runner (reading SyncSource.schedule), the SLA escalation
 * sweep, and the feature sweeps in FEATURE_TICKS (lib/ticks/*).
 *
 * SINGLE-INSTANCE ONLY: state (overlap guards, SLA "already fired" markers) is
 * in-memory, so every replica would fire duplicate work. Gate replicas with
 * `SCHEDULER_ENABLED=false` — exactly one instance keeps the default `true`
 * (see docs/deployment.md).
 *
 * Node-only. Guarded against double-registration under `next dev` HMR via a
 * globalThis flag (same pattern as lib/db.ts / lib/storage.ts). `stopScheduler`
 * clears all timers; instrumentation.ts wires it to SIGTERM/SIGINT so rolling
 * deploys don't fire ticks mid-shutdown.
 */

const g = globalThis as unknown as {
  __servioScheduler?: {
    started: boolean;
    timer?: NodeJS.Timeout;
    syncTimer?: NodeJS.Timeout;
    slaTimer?: NodeJS.Timeout;
    featureTimers?: NodeJS.Timeout[];
  };
};

/** Kill-switch: set SCHEDULER_ENABLED=false on replicas that must stay passive. */
function schedulerEnabled(): boolean {
  return (process.env.SCHEDULER_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

let polling = false;
let lastPurgeAt = 0;
/** The retention sweep runs at most this often; message ages are counted in days. */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;
let syncing = false;
let escalating = false;

async function readInboundConfig(): Promise<InboundConfig | null> {
  if (!(await getBoolSetting("IMAP_ENABLED", false))) return null;
  const [host, user, pass] = await Promise.all([
    getSetting("IMAP_HOST"),
    getSetting("IMAP_USER"),
    getSetting("IMAP_PASS"),
  ]);
  if (!host || !user || !pass) return null;
  return {
    host,
    port: await getNumberSetting("IMAP_PORT", 993),
    secure: await getBoolSetting("IMAP_SECURE", true),
    user,
    pass,
    folder: (await getSetting("IMAP_FOLDER")) ?? "INBOX",
    tlsRejectUnauthorized: await getBoolSetting("IMAP_TLS_REJECT_UNAUTHORIZED", true),
    disposition: parseDisposition(await getSetting(IMAP_PROCESSED_ACTION_SETTING)),
    processedFolder: (await getSetting(IMAP_PROCESSED_FOLDER_SETTING)) ?? DEFAULT_PROCESSED_FOLDER,
    retentionDays: parseRetentionDays(await getSetting(IMAP_RETENTION_DAYS_SETTING)) ?? 0,
  };
}

async function inboundTick(): Promise<void> {
  if (polling) return; // overlap guard — never poll on top of a running poll
  const config = await readInboundConfig();
  if (!config) return;
  polling = true;
  try {
    const res = await pollImap(config, async (mail) => {
      await processInboundMail(mail);
    });
    if (res.processed || res.failed) {
      console.log(`[servio:inbound] processed=${res.processed} failed=${res.failed}`);
    }
  } catch (e) {
    console.error("[servio:inbound] poll error:", e instanceof Error ? e.message : e);
  }
  try {
    if (config.retentionDays > 0 && Date.now() - lastPurgeAt >= PURGE_INTERVAL_MS) {
      lastPurgeAt = Date.now();
      const purged = await purgeImap(config);
      if (purged) console.log(`[servio:inbound] retention deleted ${purged} processed message(s)`);
    }
  } catch (e) {
    console.error("[servio:inbound] retention error:", e instanceof Error ? e.message : e);
  } finally {
    polling = false;
  }
}

/**
 * A scheduled source is due when its most recent cron occurrence strictly after
 * `lastRunAt` has already passed. A never-run source (lastRunAt null) is anchored
 * at the epoch, so it fires on the first tick and then advances. Invalid cron
 * expressions never fire.
 */
export function isSyncDue(
  schedule: string,
  lastRunAt: Date | null,
  now: Date,
): boolean {
  try {
    const it = CronExpressionParser.parse(schedule, {
      currentDate: lastRunAt ?? new Date(0),
    });
    return it.next().toDate() <= now;
  } catch {
    return false;
  }
}

async function syncTick(): Promise<void> {
  if (syncing) return; // overlap guard — runs are sequential across sources
  syncing = true;
  try {
    const now = new Date();
    const sources = await db.syncSource.findMany({
      where: { isActive: true, schedule: { not: null } },
    });
    for (const s of sources) {
      if (!s.schedule || !isSyncDue(s.schedule, s.lastRunAt, now)) continue;
      try {
        const res = await executeSyncRun(s, { trigger: "SCHEDULE", actorId: null });
        console.log(
          `[servio:sync] "${s.name}" ${res.status} created=${res.created} updated=${res.updated} failed=${res.failed}`,
        );
      } catch (e) {
        console.error(
          `[servio:sync] "${s.name}" error:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
  } catch (e) {
    console.error("[servio:sync] tick error:", e instanceof Error ? e.message : e);
  } finally {
    syncing = false;
  }
}

async function slaEscalationTick(): Promise<void> {
  if (escalating) return; // overlap guard — one sweep at a time
  escalating = true;
  try {
    const res = await runSlaEscalation();
    if (res.breached || res.atRisk) {
      console.log(`[servio:sla-escalation] breached=${res.breached} at-risk=${res.atRisk}`);
    }
  } catch (e) {
    console.error("[servio:sla-escalation] tick error:", e instanceof Error ? e.message : e);
  } finally {
    escalating = false;
  }
}

/**
 * A periodic sweep from lib/ticks/*. Its interval is read from `settingKey`
 * (seconds, DB setting or env), floored at `minSeconds`. Each run is
 * overlap-guarded and its errors are logged, never thrown, so one failing
 * sweep can't stop the others.
 */
type FeatureTick = {
  name: string;
  settingKey: string;
  defaultSeconds: number;
  minSeconds: number;
  run: () => Promise<void>;
};

const FEATURE_TICKS: FeatureTick[] = [
  // Incident clusters / KB gaps scan recent tickets — no need to be eager.
  { name: "insights", settingKey: "INSIGHTS_TICK_SECONDS", defaultSeconds: 900, minSeconds: 300, run: runInsightsTick },
  // Same cadence as the SLA escalation sweep: nudges must land well before the deadline.
  { name: "sla-nudge", settingKey: "SLA_NUDGE_TICK_SECONDS", defaultSeconds: 180, minSeconds: 60, run: runSlaNudgeTick },
  // Renewal notice periods are measured in days; hourly is plenty.
  { name: "contracts", settingKey: "CONTRACTS_TICK_SECONDS", defaultSeconds: 3600, minSeconds: 600, run: runContractsTick },
  // Windows start and end on the minute; the updater reports progress every few seconds.
  { name: "maintenance", settingKey: "MAINTENANCE_TICK_SECONDS", defaultSeconds: 15, minSeconds: 5, run: runMaintenanceTick },
  // GitHub rate-limits anonymous calls to 60 per hour; four checks a day is plenty.
  { name: "update-check", settingKey: "UPDATE_CHECK_TICK_SECONDS", defaultSeconds: 21600, minSeconds: 3600, run: runUpdateCheckTick },
  // Creation windows open on a wall-clock minute; a ticket a few minutes late is fine.
  { name: "recurring-tickets", settingKey: "RECURRING_TICKETS_TICK_SECONDS", defaultSeconds: 300, minSeconds: 60, run: runRecurringTicketsTick },
  // The auto-close delay is counted in days; a ticket closed within the hour is fine.
  { name: "auto-close", settingKey: "AUTO_CLOSE_TICK_SECONDS", defaultSeconds: 3600, minSeconds: 300, run: runAutoCloseTick },
];

function guardedRunner(tick: FeatureTick): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) return; // overlap guard — one run of this sweep at a time
    running = true;
    try {
      await tick.run();
    } catch (e) {
      console.error(`[servio:${tick.name}] tick error:`, e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
}

/** Each feature sweep's interval in ms, in FEATURE_TICKS order (setting value floored at its minimum). */
function readFeatureIntervalsMs(): Promise<number[]> {
  return Promise.all(
    FEATURE_TICKS.map(async (tick) => Math.max(tick.minSeconds, await getNumberSetting(tick.settingKey, tick.defaultSeconds)) * 1000),
  );
}

function startFeatureTicks(intervalsMs: number[]): NodeJS.Timeout[] {
  return FEATURE_TICKS.map((tick, i) => {
    const runner = guardedRunner(tick);
    const timer = setInterval(() => void runner(), intervalsMs[i]);
    if (typeof timer.unref === "function") timer.unref();
    void runner(); // immediate first pass, like the built-in sweeps
    return timer;
  });
}

export async function startScheduler(): Promise<void> {
  if (!schedulerEnabled()) {
    console.log("[servio:scheduler] disabled (SCHEDULER_ENABLED=false)");
    return;
  }
  if (g.__servioScheduler?.started) return; // HMR / double-register guard

  // Every setting is read BEFORE any timer exists: a failed read (DB not ready) then
  // leaves nothing running, and the timers below are created in one synchronous step.
  const [pollSeconds, syncSeconds, slaSeconds, featureIntervalsMs] = await Promise.all([
    getNumberSetting("IMAP_POLL_SECONDS", 60),
    // Sync cron granularity is one minute; tick often enough to honour it.
    getNumberSetting("SYNC_TICK_SECONDS", 60),
    // SLA escalation sweep: coarser cadence (minutes) is fine; it just needs to
    // catch breaches/at-risk within a few minutes of the deadline.
    getNumberSetting("SLA_ESCALATION_TICK_SECONDS", 180),
    readFeatureIntervalsMs(),
  ]);
  if (g.__servioScheduler?.started) return; // a concurrent start finished while the settings were read

  const intervalMs = Math.max(15, pollSeconds) * 1000;
  const syncIntervalMs = Math.max(30, syncSeconds) * 1000;
  const slaIntervalMs = Math.max(60, slaSeconds) * 1000;

  const timer = setInterval(() => void inboundTick(), intervalMs);
  const syncTimer = setInterval(() => void syncTick(), syncIntervalMs);
  const slaTimer = setInterval(() => void slaEscalationTick(), slaIntervalMs);
  for (const t of [timer, syncTimer, slaTimer]) {
    if (typeof t.unref === "function") t.unref(); // don't keep the process alive
  }
  const featureTimers = startFeatureTicks(featureIntervalsMs);

  g.__servioScheduler = { started: true, timer, syncTimer, slaTimer, featureTimers };
  console.log(
    `[servio:scheduler] started (inbound poll every ${Math.round(intervalMs / 1000)}s, sync tick every ${Math.round(syncIntervalMs / 1000)}s, sla sweep every ${Math.round(slaIntervalMs / 1000)}s, feature sweeps: ${FEATURE_TICKS.map((t) => t.name).join(", ")})`,
  );
  void inboundTick(); // immediate first pass
  void syncTick();
  void slaEscalationTick();
}

/**
 * Clear all scheduler timers (graceful shutdown). Idempotent; safe to call when
 * the scheduler never started. Wired to SIGTERM/SIGINT in instrumentation.ts.
 */
export function stopScheduler(): void {
  const s = g.__servioScheduler;
  if (!s) return;
  for (const t of [s.timer, s.syncTimer, s.slaTimer, ...(s.featureTimers ?? [])]) {
    if (t) clearInterval(t);
  }
  g.__servioScheduler = undefined;
  console.log("[servio:scheduler] stopped (timers cleared)");
}
