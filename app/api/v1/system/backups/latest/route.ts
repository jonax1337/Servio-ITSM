import { ok, preflight } from "@/lib/api";
import { backupOverview } from "@/lib/backup";
import { latestBackupPayload } from "@/lib/backup-rules";
import { agentGuard } from "../../../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * Status of the built-in backup for external monitoring: the newest run and the
 * newest verified one, with ages in seconds. Alert when `last_success_age_seconds`
 * exceeds your schedule plus a margin, or when `status` is FAILED.
 * Scope `system:read` (or the legacy `read`), agent tokens only (AGENT, MANAGER, ADMIN).
 */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "system:read");
  if ("response" in auth) return auth.response;
  const now = new Date();
  const { config, latest, lastSuccess, nextRunAt } = await backupOverview(now);
  return ok(
    latestBackupPayload({
      latest,
      lastSuccess,
      enabled: config.enabled,
      supported: config.supported,
      schedule: config.schedule,
      timezone: config.timezone,
      nextRunAt,
      now,
    }),
  );
}
