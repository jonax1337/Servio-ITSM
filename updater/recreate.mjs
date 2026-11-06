// Pure: derives the `containers/create` body for the new container from the
// old container, Watchtower-style. Only user-supplied settings survive; anything
// the old image merely defaulted is dropped so the new image's defaults win.
import { isDeepStrictEqual } from "node:util";

/** Config fields the image defines and the user may override. */
const IMAGE_DERIVED_FIELDS = ["Cmd", "Entrypoint", "Healthcheck", "User", "WorkingDir", "StopSignal", "StopTimeout", "Shell"];
const SHORT_ID_LENGTH = 12;

/**
 * @typedef {{ name: string, endpointConfig: Record<string, any> }} NetworkAttachment
 * @typedef {{ body: Record<string, any>, extraNetworks: NetworkAttachment[] }} CreateSpec
 */

/**
 * @param {any} oldContainer result of `inspectContainer`
 * @param {any} oldImage result of `inspectImage` for the container's current image
 * @param {string} newImageRef `repo:tag` of the new image
 * @returns {CreateSpec} `body` for `createContainer`; `extraNetworks` to `connectNetwork` before starting
 */
export function buildCreateSpec(oldContainer, oldImage, newImageRef) {
  const containerConfig = oldContainer.Config ?? {};
  const imageConfig = oldImage.Config ?? {};

  const config = { ...containerConfig, Image: newImageRef };
  delete config.OnBuild;
  delete config.MacAddress;
  for (const field of IMAGE_DERIVED_FIELDS) {
    if (sameAsImage(containerConfig[field], imageConfig[field])) delete config[field];
  }
  setIfNotEmpty(config, "Env", userEnv(containerConfig.Env, imageConfig.Env));
  setIfNotEmpty(config, "Labels", userLabels(containerConfig.Labels, imageConfig.Labels));
  if (config.Hostname === shortId(oldContainer.Id)) delete config.Hostname;

  const [primary, ...extraNetworks] = networkAttachments(oldContainer);
  const body = { ...config, HostConfig: withAnonymousVolumes(oldContainer) };
  if (primary) body.NetworkingConfig = { EndpointsConfig: { [primary.name]: primary.endpointConfig } };
  return { body, extraNetworks };
}

/** @param {string} id */
const shortId = (id) => id.slice(0, SHORT_ID_LENGTH);

/** @param {any} value */
const isEmpty = (value) =>
  value == null || (typeof value === "object" && Object.keys(value).length === 0);

/**
 * @param {any} fromContainer
 * @param {any} fromImage
 */
function sameAsImage(fromContainer, fromImage) {
  return (isEmpty(fromContainer) && isEmpty(fromImage)) || isDeepStrictEqual(fromContainer, fromImage);
}

/**
 * @param {Record<string, any>} target
 * @param {string} key
 * @param {any} value
 */
function setIfNotEmpty(target, key, value) {
  if (isEmpty(value)) delete target[key];
  else target[key] = value;
}

/**
 * @param {string[] | null | undefined} containerEnv
 * @param {string[] | null | undefined} imageEnv
 */
function userEnv(containerEnv, imageEnv) {
  const imageEntries = new Set(imageEnv ?? []);
  return (containerEnv ?? []).filter((entry) => !imageEntries.has(entry));
}

/**
 * @param {Record<string, string> | null | undefined} containerLabels
 * @param {Record<string, string> | null | undefined} imageLabels
 */
function userLabels(containerLabels, imageLabels) {
  return Object.fromEntries(
    Object.entries(containerLabels ?? {}).filter(([key, value]) => imageLabels?.[key] !== value),
  );
}

/**
 * Network endpoints in attach order: the network named by `HostConfig.NetworkMode`
 * first (create only accepts it as the primary endpoint), then the rest.
 * The auto-added alias equal to the old container's short id is dropped.
 *
 * @param {any} container
 * @returns {NetworkAttachment[]}
 */
function networkAttachments(container) {
  const mode = container.HostConfig?.NetworkMode;
  const wanted = mode === "default" ? "bridge" : mode;
  const attachments = Object.entries(container.NetworkSettings?.Networks ?? {}).map(
    ([name, settings]) => ({ name, endpointConfig: toEndpointConfig(settings, shortId(container.Id)) }),
  );
  return attachments.sort((a, b) => Number(b.name === wanted) - Number(a.name === wanted));
}

/**
 * Keeps only the user-configurable parts of an inspected endpoint (aliases,
 * links, static IPs, driver options); addresses and ids are runtime state.
 *
 * @param {any} settings
 * @param {string} oldShortId
 */
function toEndpointConfig(settings, oldShortId) {
  /** @type {Record<string, any>} */
  const endpointConfig = {};
  const aliases = (settings.Aliases ?? []).filter((/** @type {string} */ alias) => alias !== oldShortId);
  setIfNotEmpty(endpointConfig, "Aliases", aliases);
  setIfNotEmpty(endpointConfig, "Links", settings.Links);
  setIfNotEmpty(endpointConfig, "IPAMConfig", settings.IPAMConfig);
  setIfNotEmpty(endpointConfig, "DriverOpts", settings.DriverOpts);
  return endpointConfig;
}

/**
 * `HostConfig` is accepted by create exactly as inspect reports it, except that
 * anonymous volumes live only in the top-level `Mounts`: re-bind them by name so
 * the new container keeps the data instead of getting a fresh empty volume.
 *
 * @param {any} container
 * @returns {Record<string, any>}
 */
function withAnonymousVolumes(container) {
  const hostConfig = structuredClone(container.HostConfig ?? {});
  const declaredTargets = new Set([
    ...(hostConfig.Binds ?? []).map((/** @type {string} */ bind) => bind.split(":")[1]),
    ...(hostConfig.Mounts ?? []).map((/** @type {{ Target: string }} */ mount) => mount.Target),
  ]);
  const undeclared = (container.Mounts ?? []).filter(
    (/** @type {any} */ mount) => mount.Type === "volume" && mount.Name && !declaredTargets.has(mount.Destination),
  );
  if (undeclared.length > 0) {
    hostConfig.Binds = [
      ...(hostConfig.Binds ?? []),
      ...undeclared.map((/** @type {any} */ mount) => `${mount.Name}:${mount.Destination}${mount.RW === false ? ":ro" : ""}`),
    ];
  }
  return hostConfig;
}
