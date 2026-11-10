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
  const updaterImage = env.UPDATER_IMAGE?.trim() ? requireImageRepository(env.UPDATER_IMAGE, "UPDATER_IMAGE") : `${image}-updater`;
  const backupDir = env.BACKUP_DIR || "/backups";
  const containerName = optionalContainerName(env.SERVIO_CONTAINER, "SERVIO_CONTAINER");
  const updaterContainer = optionalContainerName(env.UPDATER_CONTAINER, "UPDATER_CONTAINER");

  return {
    image,
    /** Repository of the updater's own image; its superseded versions are cleaned up too. */
    updaterImage,
    containerName,
    /** Name of the updater's own container; a self-update replaces it under this name. */
    updaterContainer,
    /** After a successful app update to X, replace the updater with `updaterImage:X`. */
    selfUpdate: booleanFlag(env.UPDATER_SELF_UPDATE, true, "UPDATER_SELF_UPDATE"),
    /** How long the new updater may take to report in before the old one rolls the self-update back. */
    selfUpdateTimeoutMs: positiveInteger(env.UPDATER_SELF_UPDATE_TIMEOUT_SECONDS, 120, "UPDATER_SELF_UPDATE_TIMEOUT_SECONDS") * 1000,
    stateDir: env.SERVIO_STATE_DIR || "/data/state",
    dbFile: env.DB_FILE || "/data/servio.db",
    backupDir,
    /** Remove superseded images of both repositories after a successful update. */
    pruneImages: booleanFlag(env.PRUNE_IMAGES, true, "PRUNE_IMAGES"),
    /** Superseded versions kept per repository; the one an update just replaced (the rollback target) is always among them. */
    keepImages: positiveInteger(env.UPDATER_KEEP_IMAGES, 1, "UPDATER_KEEP_IMAGES"),
    /** Refuse a pull that would not fit on Docker's data root. */
    pullSpaceCheck: booleanFlag(env.PULL_SPACE_CHECK, true, "PULL_SPACE_CHECK"),
    pullSpaceMarginBytes: nonNegativeInteger(env.PULL_SPACE_MARGIN_MB, 1024, "PULL_SPACE_MARGIN_MB") * 1024 * 1024,
    /** A directory on the filesystem that holds Docker's data root; the backups volume is a named volume there by default. */
    pullSpaceProbeDir: env.PULL_SPACE_PROBE_DIR?.trim() || backupDir,
    backupKeep: positiveInteger(env.BACKUP_KEEP, 5, "BACKUP_KEEP"),
    allowUpdateWithoutBackup: env.ALLOW_UPDATE_WITHOUT_BACKUP === "true",
    allowDowngrade: env.ALLOW_DOWNGRADE === "true",
    allowPrerelease: env.ALLOW_PRERELEASE === "true",
    retryCooldownMs: positiveInteger(env.RETRY_COOLDOWN_SECONDS, 3600, "RETRY_COOLDOWN_SECONDS") * 1000,
    pullTimeoutMs: positiveInteger(env.PULL_TIMEOUT_SECONDS, 1800, "PULL_TIMEOUT_SECONDS") * 1000,
    requestMaxAgeMs: positiveInteger(env.REQUEST_MAX_AGE_SECONDS, 3600, "REQUEST_MAX_AGE_SECONDS") * 1000,
    healthTimeoutMs: positiveInteger(env.HEALTH_TIMEOUT_SECONDS, 300, "HEALTH_TIMEOUT_SECONDS") * 1000,
    healthIntervalMs: 3000,
    noHealthcheckSettleMs: 15_000,
    /** How long repeatable Docker calls are retried while Docker or the proxy does not answer. */
    dockerRetryWindowMs: 180_000,
    dockerRetryIntervalMs: 2000,
    allowedBindSources: bindSourcesFrom(env.ALLOW_BIND_MOUNTS_FROM),
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
 * `DOCKER_HOST=tcp://host:port` wins over `DOCKER_SOCKET` (the supported setup
 * points `DOCKER_SOCKET` at the socket proxy's filtered unix socket).
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

/**
 * Host directories the managed container may bind-mount; they must also be in
 * the socket proxy's `-allowbindmountfrom`.
 *
 * @param {string | undefined} value comma-separated absolute paths
 */
function bindSourcesFrom(value) {
  const dirs = (value ?? "").split(",").map((dir) => dir.trim()).filter(Boolean);
  const relative = dirs.find((dir) => !dir.startsWith("/"));
  if (relative) throw new Error(`ALLOW_BIND_MOUNTS_FROM entries must be absolute paths, got: ${relative}`);
  return dirs.map((dir) => dir.replace(/\/+$/, "") || "/");
}

/**
 * @param {string | undefined} value
 * @param {string} name
 */
function optionalContainerName(value, name) {
  const containerName = value?.trim() || undefined;
  if (containerName && !CONTAINER_NAME.test(containerName)) throw new Error(`${name} is not a valid container name: ${containerName}`);
  return containerName;
}

/**
 * @param {string | undefined} value
 * @param {string} [name]
 */
function requireImageRepository(value, name = "SERVIO_IMAGE") {
  const image = value?.trim();
  if (!image) throw new Error(`${name} is required, e.g. ghcr.io/jonax1337/servio`);
  const lastSegment = image.slice(image.lastIndexOf("/") + 1);
  if (!IMAGE_REPOSITORY.test(image) || lastSegment.includes(":")) {
    throw new Error(`${name} must be a repository without tag or digest, got: ${image}`);
  }
  return image;
}

/**
 * @param {string | undefined} value
 * @param {boolean} fallback
 * @param {string} name
 */
function booleanFlag(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false, got: ${value}`);
}

/**
 * @param {string | undefined} value
 * @param {number} fallback
 * @param {string} name
 */
function nonNegativeInteger(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a whole number of 0 or more, got: ${value}`);
  return parsed;
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
