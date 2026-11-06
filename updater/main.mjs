// Entry point: heartbeat every 15 s, poll for update requests every 5 s.
// On SIGTERM/SIGINT the loops stop; an update in progress is allowed to finish
// (give the container a long `stop_grace_period`, see docker-compose.release.yml).
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "./config.mjs";
import { createDockerClient } from "./docker-client.mjs";
import { createHeartbeat } from "./heartbeat.mjs";
import { ensureDirectory, statePaths } from "./state-files.mjs";
import { createUpdateFlow } from "./update-flow.mjs";

/**
 * Runs `task` every `intervalMs` until `signal` aborts. A failing task is logged
 * and retried on the next tick instead of ending the loop.
 *
 * @param {number} intervalMs
 * @param {() => Promise<unknown>} task
 * @param {AbortSignal} signal
 */
async function every(intervalMs, task, signal) {
  while (!signal.aborted) {
    try {
      await task();
    } catch (error) {
      console.error("[updater] task failed:", error);
    }
    await delay(intervalMs, undefined, { signal }).catch((/** @type {Error} */ error) => {
      if (error.name !== "AbortError") throw error;
    });
  }
}

async function main() {
  const config = loadConfig();
  const paths = statePaths(config.stateDir);
  const docker = createDockerClient({
    ...config.dockerEndpoint,
    apiVersion: config.apiVersion,
    registryAuth: config.registryAuth,
  });
  await ensureDirectory(paths.stateDir);
  await ensureDirectory(paths.updaterDir);
  await ensureDirectory(config.backupDir);

  const flow = createUpdateFlow({ docker, config });
  await flow.recoverInterrupted();
  const beat = createHeartbeat({ docker, config, paths });

  const stop = new AbortController();
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => stop.abort());

  console.log(`[updater] v${config.updaterVersion} managing ${config.containerName ?? "the labelled container"} (${config.image})`);
  await Promise.all([
    every(config.heartbeatIntervalMs, beat, stop.signal),
    every(config.pollIntervalMs, () => flow.processPendingRequest(), stop.signal),
  ]);
  console.log("[updater] stopped");
}

main().catch((error) => {
  console.error("[updater] fatal:", error instanceof Error ? error.message : error);
  process.exit(1);
});
