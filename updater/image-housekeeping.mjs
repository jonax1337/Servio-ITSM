// Disk housekeeping around an update: how much room a pull needs, and which
// superseded images of the managed repositories can go once an update succeeded.
// Planning is pure; `pruneSupersededImages` performs the plan through the Docker
// client and never forces a removal, so Docker itself refuses (409) to delete an
// image that any container still uses.
import { VERSION_LABEL } from "./managed-container.mjs";
import { compareVersions } from "./versions.mjs";

/** A download size larger than this is not believed (the hint comes from an app-writable file). */
export const MAX_DOWNLOAD_HINT_BYTES = 256 * 1024 ** 3;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const TAG = /^[\w][\w.-]{0,127}$/;
const UNTAGGED = "<none>:<none>";
const UNTAGGED_DIGEST = "<none>@<none>";

/**
 * @typedef {{ Id: string, RepoTags?: string[] | null, RepoDigests?: string[] | null,
 *   Labels?: Record<string, string> | null, Created?: number }} ImageSummary
 * @typedef {{ id: string, version: string, refs: string[] }} PrunableImage
 * @typedef {{ removed: string[], kept: string[], failed: string[] }} PruneResult
 *   `kept`: images Docker refused to delete because a container uses them
 */

/**
 * The space a pull needs on Docker's data root: the compressed download, the
 * unpacked layers and a margin. The app reads the download from the registry
 * manifest: only the layers the installed release does not share
 * (`downloadBytes`), out of the whole image (`imageBytes`). The unpacked size of
 * those layers is not known before the pull, so it is scaled from the installed
 * image (a new release is about as large as the one it replaces): the installed
 * size times the share of the image that is new. Without the image size the
 * whole installed size stands in; without any registry size, the installed size
 * stands in for the download too.
 *
 * @param {{ downloadBytes: number | null, imageBytes?: number | null, installedBytes: number | null | undefined, marginBytes: number }} input
 */
export function pullSpaceNeeded({ downloadBytes, imageBytes = null, installedBytes, marginBytes }) {
  const installed = Number.isFinite(installedBytes) && /** @type {number} */ (installedBytes) > 0 ? /** @type {number} */ (installedBytes) : 0;
  const download = downloadBytes ?? installed;
  const newShare = downloadBytes !== null && imageBytes !== null && imageBytes >= downloadBytes ? downloadBytes / imageBytes : 1;
  const unpacked = Math.max(Math.round(installed * newShare), download);
  return { download, unpacked, margin: marginBytes, total: download + unpacked + marginBytes };
}

/**
 * The compressed size of the target image as the app read it from the registry
 * manifest (`downloadBytes` in request.json), or null when absent or implausible.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
export function downloadHint(value) {
  return Number.isSafeInteger(value) && /** @type {number} */ (value) > 0 && /** @type {number} */ (value) <= MAX_DOWNLOAD_HINT_BYTES
    ? /** @type {number} */ (value)
    : null;
}

/**
 * @param {string} repository
 * @param {string} ref `repo:tag`
 * @returns {string | null} the tag when `ref` is a tag of `repository`
 */
function tagIn(repository, ref) {
  if (!ref.startsWith(`${repository}:`)) return null;
  const tag = ref.slice(repository.length + 1);
  return TAG.test(tag) ? tag : null;
}

/**
 * @param {string} repository
 * @param {string} ref `repo@sha256:…`
 */
function isDigestIn(repository, ref) {
  return ref.startsWith(`${repository}@`) && DIGEST.test(ref.slice(repository.length + 1));
}

/**
 * The image's references when every one of them belongs to `repository` and it
 * carries at most one tag; null when it is shared with another repository (it is
 * not ours to remove), has no reference, or has several tags. Docker checks
 * whether a container uses an image only when the reference removed is its last
 * tag (digests of the same repository do not count): removing one of several
 * tags just untags it, even under a running container. So only single-tag
 * images are removed, tag first (Docker answers 409 when a container uses it
 * and nothing is untagged); several tags only come from manual pulls and stay.
 *
 * @param {ImageSummary} image
 * @param {string} repository
 * @returns {{ tags: string[], refs: string[] } | null}
 */
function ownReferences(image, repository) {
  const tags = (image.RepoTags ?? []).filter((ref) => ref !== UNTAGGED);
  const digests = (image.RepoDigests ?? []).filter((ref) => ref !== UNTAGGED_DIGEST);
  if (tags.length > 1) return null;
  if (tags.some((ref) => tagIn(repository, ref) === null) || digests.some((ref) => !isDigestIn(repository, ref))) return null;
  // Removing the last tag also drops the digests of the same repository; a digest that is
  // left over (an untagged image) is removed by its own reference, the check applies there too.
  const refs = [...tags, ...digests];
  return refs.length > 0 ? { tags: tags.map((ref) => /** @type {string} */ (tagIn(repository, ref))), refs } : null;
}

/**
 * The release an image holds: its version label, else a semantic-version tag.
 *
 * @param {ImageSummary} image
 * @param {string[]} tags
 * @returns {string | null}
 */
function versionOf(image, tags) {
  const labelled = image.Labels?.[VERSION_LABEL];
  if (labelled && compareVersions(labelled, labelled) !== null) return labelled;
  return tags.find((tag) => compareVersions(tag, tag) !== null) ?? null;
}

/**
 * Which images of `repository` are superseded and may be removed. Kept are: the
 * images in `protectedIds`, every image that is not older than `runningVersion`
 * (the running release and anything pulled ahead of it), every image whose
 * version cannot be told, every image that also carries a reference of another
 * repository or several tags, and the `keep` newest superseded releases. The
 * image an update just replaced (`rollbackImageId`, the rollback target) is
 * always kept and counts as the first of them, whatever its version label says.
 * `protectedVersions` names releases that stay whatever their order (the running
 * updater, found by its version because the updater does not know its own image id).
 *
 * @param {{ images: ImageSummary[], repository: string, runningVersion: string | null, protectedIds: string[],
 *   protectedVersions?: string[], rollbackImageId: string | null, keep: number }} input
 * @returns {PrunableImage[]} images to remove, oldest release last
 */
export function planImagePrune({ images, repository, runningVersion, protectedIds, protectedVersions = [], rollbackImageId, keep }) {
  if (!runningVersion || compareVersions(runningVersion, runningVersion) === null) return [];
  const protectedSet = new Set(protectedIds);
  const keepsRollback = rollbackImageId !== null && !protectedSet.has(rollbackImageId) && images.some((image) => image.Id === rollbackImageId);
  /** @type {PrunableImage[]} */
  const superseded = [];
  for (const image of images) {
    if (protectedSet.has(image.Id) || image.Id === rollbackImageId) continue;
    const own = ownReferences(image, repository);
    if (!own) continue;
    const version = versionOf(image, own.tags);
    const order = version === null ? null : compareVersions(version, runningVersion);
    if (version === null || order === null || order >= 0 || protectedVersions.includes(version)) continue;
    superseded.push({ id: image.Id, version, refs: own.refs });
  }
  superseded.sort((a, b) => /** @type {number} */ (compareVersions(b.version, a.version)));
  return superseded.slice(Math.max(keep - Number(keepsRollback), 0));
}

/**
 * Removes what `planImagePrune` selects, reference by reference and never by
 * force. A 404 (already gone) counts as removed; a 409 means a container uses the
 * image, which then stays with its references.
 *
 * @param {{ docker: import("./docker-client.mjs").DockerClient, repository: string, runningVersion: string | null,
 *   protectedIds: string[], protectedVersions?: string[], rollbackImageId: string | null, keep: number }} options
 * @returns {Promise<PruneResult>}
 */
export async function pruneSupersededImages({ docker, repository, ...plan }) {
  const images = await docker.listImages(repository);
  /** @type {PruneResult} */
  const result = { removed: [], kept: [], failed: [] };
  for (const image of planImagePrune({ images, repository, ...plan })) {
    const label = `${repository}:${image.version}`;
    const outcome = await removeReferences(docker, image.refs);
    if (outcome === "removed") result.removed.push(label);
    else if (outcome === "in-use") result.kept.push(label);
    else result.failed.push(`${label} (${outcome})`);
  }
  return result;
}

/**
 * @param {import("./docker-client.mjs").DockerClient} docker
 * @param {string[]} refs the single tag first (see `ownReferences`)
 * @returns {Promise<string>} "removed", "in-use" or the error message
 */
async function removeReferences(docker, refs) {
  for (const ref of refs) {
    try {
      await docker.removeImage(ref);
    } catch (error) {
      const status = /** @type {{ status?: number }} */ (error).status;
      if (status === 404) continue;
      if (status === 409) return "in-use";
      return error instanceof Error ? error.message : String(error);
    }
  }
  return "removed";
}

/**
 * One sentence for the update status, or "" when nothing happened.
 *
 * @param {PruneResult} result
 */
export function describePrune(result) {
  const parts = [];
  if (result.removed.length > 0) parts.push(`Removed superseded images: ${result.removed.join(", ")}.`);
  if (result.kept.length > 0) parts.push(`Kept superseded images a container still uses: ${result.kept.join(", ")}.`);
  if (result.failed.length > 0) parts.push(`Could not remove: ${result.failed.join(", ")}.`);
  return parts.join(" ");
}

/** @param {number} bytes */
export const formatBytes = (bytes) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
