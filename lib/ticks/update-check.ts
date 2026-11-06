/**
 * Scheduler tick that looks for new Servio releases (lib/updates.ts) and
 * notifies the admins once per new version. A no-op while UPDATE_CHECK_ENABLED
 * is off. Run by lib/scheduler.ts with an overlap guard and error isolation.
 */
import { checkForUpdates, updateChecksEnabled } from "@/lib/updates";

export async function runUpdateCheckTick(): Promise<void> {
  if (!(await updateChecksEnabled())) return;
  const result = await checkForUpdates();
  if (!result.ok) console.warn(`[servio:update-check] ${result.error}`);
}
