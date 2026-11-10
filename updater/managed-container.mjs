// Locating the one container the updater is allowed to touch.

/** Label that marks the managed container (set in docker-compose.release.yml). */
export const MANAGED_LABEL = "servio.updater.managed";
/**
 * Set by the updater on every container it creates, to the id of the request that
 * created it: crash recovery removes only containers carrying its own request id.
 */
export const UPDATE_REQUEST_LABEL = "servio.updater.request";
/** Release version of an image (set by the release workflow); containers inherit it. */
export const VERSION_LABEL = "org.opencontainers.image.version";

/**
 * Resolves the managed container by name (`SERVIO_CONTAINER`) or, without a
 * name, as the single container carrying the managed label. A named container
 * must carry the label too, so a mistyped name can never point the updater at
 * an unrelated container (or at itself).
 *
 * @param {import("./docker-client.mjs").DockerClient} docker
 * @param {string | undefined} containerName
 * @returns {Promise<any>} inspected container
 */
export async function findManagedContainer(docker, containerName) {
  const container = containerName
    ? await docker.inspectContainer(containerName)
    : await inspectSoleLabeledContainer(docker);
  if (container.Config?.Labels?.[MANAGED_LABEL] !== "true") {
    throw new Error(`Container ${containerNameOf(container)} lacks the label ${MANAGED_LABEL}=true; refusing to manage it`);
  }
  return container;
}

/** @param {import("./docker-client.mjs").DockerClient} docker */
async function inspectSoleLabeledContainer(docker) {
  const candidates = await docker.listContainers(`${MANAGED_LABEL}=true`);
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one container labelled ${MANAGED_LABEL}=true, found ${candidates.length}; set SERVIO_CONTAINER`,
    );
  }
  return docker.inspectContainer(candidates[0].Id);
}

/**
 * @param {any} container inspected container
 * @returns {string} container name without the leading slash
 */
export function containerNameOf(container) {
  return String(container.Name).replace(/^\//, "");
}

/**
 * Version of the running image: the OCI label, else the tag of the image reference
 * (none for a container pinned by image id or digest).
 *
 * @param {any} container inspected container
 * @returns {string | null}
 */
export function installedVersionOf(container) {
  const labelled = container.Config?.Labels?.[VERSION_LABEL];
  if (labelled) return labelled;
  const reference = String(container.Config?.Image ?? "");
  if (/^sha256:|@/.test(reference)) return null; // pinned by id/digest: no tag to read
  const tag = reference.slice(reference.lastIndexOf("/") + 1).split(":")[1];
  return tag || null;
}

/**
 * @param {import("./docker-client.mjs").DockerClient} docker
 * @param {string} nameOrId
 * @returns {Promise<any | null>} the inspected container, or null when Docker says it does not exist
 */
export async function inspectContainerOrNull(docker, nameOrId) {
  try {
    return await docker.inspectContainer(nameOrId);
  } catch (error) {
    if (/** @type {{ status?: number }} */ (error).status === 404) return null;
    throw error;
  }
}

/** @param {Promise<unknown>} call */
export async function ignoreNotFound(call) {
  try {
    await call;
  } catch (error) {
    if (/** @type {{ status?: number }} */ (error).status !== 404) throw error;
  }
}

/** @param {{ Name?: string } | null | undefined} policy a restart policy under which Docker starts the container on its own */
export function hasRestartPolicy(policy) {
  return Boolean(policy?.Name) && policy?.Name !== "no";
}
