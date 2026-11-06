import { readJsonFile, statePath } from "@/lib/state-dir";
import { parseMaintenanceFlag, type MaintenanceFlag } from "@/lib/maintenance-rules";

/**
 * Read side of maintenance.json, split out of lib/maintenance.ts so proxy.ts can
 * use it without pulling in Prisma. Read on every request: the proxy must not rely
 * on module state shared with the app (Next.js proxy docs).
 */

export const MAINTENANCE_FLAG_FILE = "maintenance.json";

export const readMaintenanceFlag = (): MaintenanceFlag | null =>
  parseMaintenanceFlag(readJsonFile(statePath(MAINTENANCE_FLAG_FILE)));
