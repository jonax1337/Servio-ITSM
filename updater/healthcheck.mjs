// Container HEALTHCHECK: healthy while the heartbeat file is fresh.
import { pathToFileURL } from "node:url";
import { HEARTBEAT_FRESH_MS } from "./heartbeat.mjs";
import { MAX_SMALL_JSON_BYTES, readJsonFile, statePaths } from "./state-files.mjs";

/**
 * @param {string} heartbeatFile
 * @param {number} now epoch milliseconds
 */
export async function isHeartbeatFresh(heartbeatFile, now) {
  const heartbeat = await readJsonFile(heartbeatFile, MAX_SMALL_JSON_BYTES);
  return Boolean(heartbeat) && now - Date.parse(heartbeat.at) < HEARTBEAT_FRESH_MS;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { heartbeat } = statePaths(process.env.SERVIO_STATE_DIR || "/data/state");
  process.exit((await isHeartbeatFresh(heartbeat, Date.now())) ? 0 : 1);
}
