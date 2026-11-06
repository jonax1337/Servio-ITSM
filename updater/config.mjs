// Environment parsing. Everything the updater may touch is fixed here, at start-up.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_API_VERSION, DEFAULT_SOCKET_PATH } from "./docker-client.mjs";

const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/;
const IMAGE_REPOSITORY = /^[a-z0-9][a-z0-9._\-/:]*$/;

/**
 * @typedef {ReturnType<typeof loadConfig>} UpdaterConfig
 */

/**
 * @param {Record<string, string | undefined>} [env]
 * @throws {Error} when SERVIO_IMAGE or SERVIO_CONTAINER is missing or malformed
 */
export function loadConfig(env = process.env) {
  const image = requireImageRepository(env.SERVIO_IMAGE);
  const containerName = env.SERVIO_CONTAINER?.trim() || undefined;
  if (containerName && !CONTAINER_NAME.test(containerName)) {
    throw new Error(`SERVIO_CONTAINER is not a valid container name: ${containerName}`);
  }

  return {
    image,
    containerName,
    stateDir: env.SERVIO_STATE_DIR || "/data/state",
    dbFile: env.DB_FILE || "/data/servio.db",
    backupDir: env.BACKUP_DIR || "/backups",
    backupKeep: positiveInteger(env.BACKUP_KEEP, 5, "BACKUP_KEEP"),
    allowUpdateWithoutBackup: env.ALLOW_UPDATE_WITHOUT_BACKUP === "true",
    allowDowngrade: env.ALLOW_DOWNGRADE === "true",
    pullTimeoutMs: positiveInteger(env.PULL_TIMEOUT_SECONDS, 1800, "PULL_TIMEOUT_SECONDS") * 1000,
    requestMaxAgeMs: positiveInteger(env.REQUEST_MAX_AGE_SECONDS, 3600, "REQUEST_MAX_AGE_SECONDS") * 1000,
    healthTimeoutMs: positiveInteger(env.HEALTH_TIMEOUT_SECONDS, 300, "HEALTH_TIMEOUT_SECONDS") * 1000,
    healthIntervalMs: 3000,
    noHealthcheckSettleMs: 15_000,
    stopTimeoutSec: 30,
    pollIntervalMs: 5000,
    heartbeatIntervalMs: 15_000,
    dockerEndpoint: dockerEndpointFrom(env),
    apiVersion: env.DOCKER_API_VERSION || DEFAULT_API_VERSION,
    registryAuth: env.REGISTRY_AUTH?.trim() || undefined,
    updaterVersion: readUpdaterVersion(),
  };
}

/**
 * `DOCKER_HOST=tcp://host:port` (a docker-socket-proxy) wins over `DOCKER_SOCKET`.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {import("./docker-client.mjs").DockerEndpoint}
 */
function dockerEndpointFrom(env) {
  const dockerHost = env.DOCKER_HOST?.trim();
  if (!dockerHost) return { socketPath: env.DOCKER_SOCKET || DEFAULT_SOCKET_PATH };
  const url = new URL(dockerHost);
  if (url.protocol !== "tcp:" || !url.hostname) {
    throw new Error(`DOCKER_HOST must look like tcp://host:port, got: ${dockerHost}`);
  }
  return { host: url.hostname.replace(/^\[(.*)\]$/, "$1"), port: Number(url.port) || 2375 };
}

/** @param {string | undefined} value */
function requireImageRepository(value) {
  const image = value?.trim();
  if (!image) throw new Error("SERVIO_IMAGE is required, e.g. ghcr.io/jonax1337/servio");
  const lastSegment = image.slice(image.lastIndexOf("/") + 1);
  if (!IMAGE_REPOSITORY.test(image) || lastSegment.includes(":")) {
    throw new Error(`SERVIO_IMAGE must be a repository without tag or digest, got: ${image}`);
  }
  return image;
}

/**
 * @param {string | undefined} value
 * @param {number} fallback
 * @param {string} name
 */
function positiveInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer, got: ${value}`);
  return parsed;
}

function readUpdaterVersion() {
  const manifest = join(dirname(fileURLToPath(import.meta.url)), "package.json");
  return JSON.parse(readFileSync(manifest, "utf8")).version;
}
