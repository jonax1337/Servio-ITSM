/**
 * Scheduler ticks of the built-in backup (lib/backup.ts). `runBackupTick`
 * starts a scheduled backup when one is due (the run itself happens in a child
 * process; this tick waits for it, its overlap guard keeps runs from stacking).
 * `runAppHeartbeatTick` keeps the app's liveness file fresh, so the restore
 * script refuses to run while the app is up. Run by lib/scheduler.ts with
 * overlap guards and error isolation.
 */
import { runScheduledBackupIfDue, writeAppHeartbeat } from "@/lib/backup";

export async function runBackupTick(): Promise<void> {
  await runScheduledBackupIfDue();
}

export async function runAppHeartbeatTick(): Promise<void> {
  writeAppHeartbeat();
}
