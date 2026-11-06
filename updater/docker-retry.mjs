// Retries Docker calls while Docker, or the socket proxy in front of it, is
// briefly unreachable (a restart of the proxy, a daemon under load). A rollback
// that gave up on the first refused connection would leave the app down.
import { DockerApiError } from "./docker-client.mjs";

/** Calls that are safe to repeat: repeating one that already took effect changes nothing. */
const REPEATABLE_METHODS = new Set(["ping", "inspectContainer", "inspectImage", "stopContainer", "startContainer", "updateContainer", "removeContainer"]);

/**
 * @typedef {{ clock: { now: () => number, sleep: (ms: number) => Promise<void> }, windowMs: number, intervalMs: number,
 *   log: (line: string) => void }} RetryOptions
 */

/**
 * Connection failures and 5xx answers are transient; any other answer is the daemon's real reply.
 *
 * @param {unknown} error
 */
export function isTransientDockerError(error) {
  return error instanceof DockerApiError ? error.status >= 500 : true;
}

/**
 * @template T
 * @param {() => Promise<T>} attempt must be safe to repeat
 * @param {RetryOptions} options
 * @returns {Promise<T>}
 */
export async function retryWhileUnreachable(attempt, { clock, windowMs, intervalMs, log }) {
  const deadline = clock.now() + windowMs;
  for (let retries = 0; ; retries += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!isTransientDockerError(error) || clock.now() >= deadline) throw error;
      if (retries === 0) {
        log(`[updater] Docker is not answering (${error instanceof Error ? error.message : error}); retrying for up to ${windowMs / 1000}s`);
      }
      await clock.sleep(intervalMs);
    }
  }
}

/**
 * @param {import("./docker-client.mjs").DockerClient} docker
 * @param {RetryOptions} options
 * @returns {import("./docker-client.mjs").DockerClient} the same client, its repeatable calls retried
 */
export function withRetries(docker, options) {
  return new Proxy(docker, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      const call = value.bind(target);
      if (!REPEATABLE_METHODS.has(String(property))) return call;
      return (/** @type {unknown[]} */ ...args) => retryWhileUnreachable(() => call(...args), options);
    },
  });
}
