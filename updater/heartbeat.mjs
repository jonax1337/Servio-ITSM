// Liveness file the app reads to decide whether updates can be scheduled.
import { containerNameOf, findManagedContainer } from "./managed-container.mjs";
import { writeJsonAtomic } from "./state-files.mjs";

/** The app treats the updater as connected while the heartbeat is younger than this. */
export const HEARTBEAT_FRESH_MS = 60_000;

/**
 * @param {{
 *   docker: import("./docker-client.mjs").DockerClient,
 *   config: import("./config.mjs").UpdaterConfig,
 *   paths: ReturnType<typeof import("./state-files.mjs").statePaths>,
 *   now?: () => number,
 *   log?: (line: string) => void,
 * }} deps
 * @returns {() => Promise<void>} writes one heartbeat
 */
export function createHeartbeat({ docker, config, paths, now = Date.now, log = console.log }) {
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
        at: new Date(now()).toISOString(),
        dockerOk,
        ...(await describeManagedContainer(dockerOk)),
      },
      [paths.stateDir, paths.updaterDir],
    );
  };
}
