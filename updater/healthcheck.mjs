// Container HEALTHCHECK: healthy while the updater's loop keeps refreshing its
// liveness stamp on the backup volume (heartbeat.json is app-writable, so it is not used).
import { pathToFileURL } from "node:url";
import { HEARTBEAT_FRESH_MS, livenessFile } from "./heartbeat.mjs";
import { MAX_SMALL_JSON_BYTES, readJsonFile } from "./state-files.mjs";

/**
 * @param {string} stampFile
 * @param {number} now epoch milliseconds
 */
export async function isLivenessFresh(stampFile, now) {
  const stamp = await readJsonFile(stampFile, MAX_SMALL_JSON_BYTES);
  return typeof stamp?.at === "string" && now - Date.parse(stamp.at) < HEARTBEAT_FRESH_MS;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit((await isLivenessFresh(livenessFile(process.env.BACKUP_DIR || "/backups"), Date.now())) ? 0 : 1);
}
