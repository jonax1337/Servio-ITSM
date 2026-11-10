// The updater's lifecycle, separate from process wiring so it can be tested:
// crash recovery first (it needs only Docker and the updater-only backup
// volume), then the app-writable state directory, then the heartbeat and
// request loops until `signal` aborts or a self-update handed over to a new
// updater. An update in progress is allowed to finish when the signal fires
// (see `stop_grace_period` in docker-compose.release.yml).
import { setTimeout as delay } from "node:timers/promises";
import { createHeartbeat } from "./heartbeat.mjs";
import { createSelfUpdate } from "./self-update.mjs";
import { ensureDirectory, statePaths } from "./state-files.mjs";
import { createUpdateFlow, systemClock } from "./update-flow.mjs";

/**
 * @param {{
 *   config: import("./config.mjs").UpdaterConfig,
 *   docker: import("./docker-client.mjs").DockerClient,
 *   signal: AbortSignal,
 *   clock?: import("./update-flow.mjs").Clock,
 *   log?: (line: string) => void,
 *   hostname?: () => string,
 * }} deps `hostname` identifies the updater's own container for a self-update (default: the OS hostname)
 */
export async function runUpdater({ config, docker, signal, clock = systemClock, log = console.log, hostname }) {
  await ensureDirectory(config.backupDir);
  if (!(await waitForDocker(docker, config.pollIntervalMs, signal, log))) return;

  const retired = new AbortController();
  const running = AbortSignal.any([signal, retired.signal]);
  const selfUpdate = createSelfUpdate({ docker, config, clock, log, hostname, retire: () => retired.abort() });
  const flow = createUpdateFlow({ docker, config, clock, log, selfUpdate });
  await flow.recoverInterrupted();
  await selfUpdate.resolvePending();
  const imageNote = await flow.pruneUpdaterImages();
  if (imageNote) log(`[updater] ${imageNote}`);

  const paths = statePaths(config.stateDir);
  await prepareStateDirectories(paths, log);
  const beat = createHeartbeat({
    docker,
    config,
    paths,
    now: clock.now,
    log,
    activeRequest: flow.activeRequest,
    selfUpdateResult: selfUpdate.readResult,
    paused: selfUpdate.isHandingOver,
  });

  if (!running.aborted) {
    log(`[updater] v${config.updaterVersion} managing ${config.containerName ?? "the labelled container"} (${config.image})`);
    await Promise.all([
      every(config.heartbeatIntervalMs, beat, running, log),
      every(config.pollIntervalMs, () => flow.processPendingRequest(), running, log),
    ]);
  }
  log(retired.signal.aborted ? "[updater] stopped: handed over to the new updater" : "[updater] stopped");
}

/**
 * Recovery needs Docker; after a host reboot the socket proxy may come up later than the updater.
 *
 * @param {import("./docker-client.mjs").DockerClient} docker
 * @param {number} retryMs
 * @param {AbortSignal} signal
 * @param {(line: string) => void} log
 * @returns {Promise<boolean>} false when `signal` aborted first
 */
async function waitForDocker(docker, retryMs, signal, log) {
  for (let attempt = 0; !signal.aborted; attempt += 1) {
    try {
      await docker.ping();
      return true;
    } catch (error) {
      if (attempt === 0) log(`[updater] waiting for Docker before recovering: ${error instanceof Error ? error.message : error}`);
    }
    await sleepUnlessAborted(retryMs, signal);
  }
  return false;
}

/**
 * The app can delete or replace these directories at any time; that must not stop
 * the updater from running (the heartbeat and status writes then fail and are logged).
 *
 * @param {ReturnType<typeof statePaths>} paths
 * @param {(line: string) => void} log
 */
async function prepareStateDirectories(paths, log) {
  try {
    await ensureDirectory(paths.stateDir);
    await ensureDirectory(paths.updaterDir);
  } catch (error) {
    log(`[updater] state directory unusable, continuing without it: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Runs `task` every `intervalMs` until `signal` aborts. A failing task is logged
 * and retried on the next tick instead of ending the loop.
 *
 * @param {number} intervalMs
 * @param {() => Promise<unknown>} task
 * @param {AbortSignal} signal
 * @param {(line: string) => void} log
 */
async function every(intervalMs, task, signal, log) {
  while (!signal.aborted) {
    try {
      await task();
    } catch (error) {
      log(`[updater] task failed: ${error instanceof Error ? (error.stack ?? error.message) : error}`);
    }
    await sleepUnlessAborted(intervalMs, signal);
  }
}

/**
 * @param {number} ms
 * @param {AbortSignal} signal
 */
async function sleepUnlessAborted(ms, signal) {
  await delay(ms, undefined, { signal }).catch((/** @type {Error} */ error) => {
    if (error.name !== "AbortError") throw error;
  });
}
