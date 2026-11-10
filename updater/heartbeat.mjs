// Liveness: `heartbeat.json` for the app (it decides whether updates can be
// scheduled) and a stamp on the updater-only backup volume for the container
// HEALTHCHECK, which must not trust a file the app can forge. The stamp carries
// the updater's version: during a self-update it proves that the new updater runs.
import { join } from "node:path";
import { containerNameOf, findManagedContainer } from "./managed-container.mjs";
import { writeJsonAtomic } from "./state-files.mjs";

/** The app treats the updater as connected while the heartbeat is younger than this. */
export const HEARTBEAT_FRESH_MS = 60_000;

/** @param {string} backupDir */
export const livenessFile = (backupDir) => join(backupDir, ".liveness.json");

/**
 * @param {{
 *   docker: import("./docker-client.mjs").DockerClient,
 *   config: import("./config.mjs").UpdaterConfig,
 *   paths: ReturnType<typeof import("./state-files.mjs").statePaths>,
 *   now?: () => number,
 *   log?: (line: string) => void,
 *   activeRequest?: () => import("./update-flow.mjs").ActiveRequest | null,
 *   selfUpdateResult?: () => Promise<import("./self-update.mjs").SelfUpdateResult | null>,
 *   paused?: () => boolean,
 * }} deps `activeRequest` tells the app which update is in progress, so it can tell a
 *   working updater from one that lost track of an update (e.g. could not write status.json);
 *   `selfUpdateResult` is the outcome of the last self-update, shown to admins; while `paused`
 *   (a self-update hands over to a new updater) nothing is written, so only the new updater can prove it runs
 * @returns {() => Promise<void>} writes one heartbeat
 */
export function createHeartbeat({
  docker,
  config,
  paths,
  now = Date.now,
  log = console.log,
  activeRequest = () => null,
  selfUpdateResult = async () => null,
  paused = () => false,
}) {
  let wasDockerOk = true;

  /**
   * Best effort: the heartbeat must still be written when the container cannot be found.
   *
   * @param {boolean} dockerOk
   */
  async function describeManagedContainer(dockerOk) {
    const unknown = { container: config.containerName ?? null, image: null };
    if (!dockerOk) return unknown;
    try {
      const container = await findManagedContainer(docker, config.containerName);
      return { container: containerNameOf(container), image: container.Config?.Image ?? null };
    } catch {
      return unknown;
    }
  }

  return async function beat() {
    if (paused()) return;
    const at = new Date(now()).toISOString();
    // First, so a sabotaged state directory cannot make the updater look dead (or alive).
    await writeJsonAtomic(livenessFile(config.backupDir), { at, version: config.updaterVersion }, [config.backupDir]);

    let dockerOk = true;
    try {
      await docker.ping();
    } catch (error) {
      dockerOk = false;
      if (wasDockerOk) log(`[updater] Docker is not reachable: ${error instanceof Error ? error.message : error}`);
    }
    if (dockerOk && !wasDockerOk) log("[updater] Docker is reachable again");
    wasDockerOk = dockerOk;

    await writeJsonAtomic(
      paths.heartbeat,
      {
        updaterVersion: config.updaterVersion,
        at,
        dockerOk,
        ...(await describeManagedContainer(dockerOk)),
        activeRequestId: activeRequest()?.id ?? null,
        selfUpdate: await selfUpdateResult(),
      },
      [paths.stateDir, paths.updaterDir],
    );
  };
}
