"use server";

import { revalidatePath } from "next/cache";
import { requireAdminUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { executeBackupRun, readBackupConfig, startBackupRun } from "@/lib/backup";
import type { ActionResult } from "@/lib/action-result";

/**
 * Starts a backup right away (Settings › Backups › Back up now). The run is
 * claimed here and continues in the background: a large backup can take
 * minutes, longer than a request should wait. The page polls while it runs.
 */
export async function backupNow(): Promise<ActionResult> {
  const me = await requireAdminUser();
  if (!me) return { ok: false, error: "Only admins can start a backup." };
  const config = await readBackupConfig();
  const started = await startBackupRun("MANUAL", me.id, config);
  if (!started.ok) return { ok: false, error: started.error };
  await writeAudit({
    userId: me.id,
    action: "CREATE",
    entity: "BackupRun",
    entityId: started.runId,
    summary: "Started a manual backup",
  });
  // Not awaited: the page is dynamic and refreshes itself until the run is finished.
  void executeBackupRun(started.runId, "MANUAL", config);
  revalidatePath("/settings/backups");
  return { ok: true };
}
