import { safeFetch, type SafeFetchOptions, type SafeFetchResponse } from "@/lib/safe-fetch";

/**
 * How many bytes pulling a release will download: the compressed layers plus the
 * image config, read from the registry manifest (OCI distribution API). Layers
 * the running release shares with the target (same digest in its manifest) are
 * already on the host and not counted. The app hands the result to the updater
 * sidecar with the update request, so the updater can refuse a pull that would
 * not fit on Docker's data root before it starts (docs/updates.md). The updater
 * has no network, so the app asks the registry.
 *
 * Best effort: anonymous (or bearer-token) pulls of public images only. Any
 * failure returns null and the updater falls back to its own estimate. Requests
 * go through safeFetch (public addresses only, no redirects).
 */

/** The published image; a source build or mirror sets SERVIO_IMAGE on the app (docs/configuration.md). */
export const DEFAULT_SERVIO_IMAGE = "ghcr.io/jonax1337/servio";

const DOCKER_HUB_REGISTRY = "registry-1.docker.io";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const INDEX_TYPES = ["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"];
const MANIFEST_TYPES = ["application/vnd.oci.image.manifest.v1+json", "application/vnd.docker.distribution.manifest.v2+json"];
const ACCEPT = [...INDEX_TYPES, ...MANIFEST_TYPES].join(", ");
const REPOSITORY = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
const REGISTRY_HOST = /^[A-Za-z0-9.-]+(?::\d{1,5})?$/;
const TAG = /^[\w][\w.-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export type ImageLocation = { registry: string; repository: string };

/** `ghcr.io/owner/servio` → registry + repository path; Docker Hub names get their implicit host (and `library/`). Null when malformed. */
export function parseImageRepository(image: string): ImageLocation | null {
  const trimmed = image.trim();
  const slash = trimmed.indexOf("/");
  const first = slash === -1 ? "" : trimmed.slice(0, slash);
  const hasRegistry = first.includes(".") || first.includes(":") || first === "localhost";
  const registry = hasRegistry ? first : DOCKER_HUB_REGISTRY;
  let repository = hasRegistry ? trimmed.slice(slash + 1) : trimmed;
  if (!hasRegistry && !repository.includes("/")) repository = `library/${repository}`;
  if (!REGISTRY_HOST.test(registry) || !REPOSITORY.test(repository)) return null;
  return { registry, repository };
}

export type BearerChallenge = { realm: string; service?: string; scope?: string };

/** The `WWW-Authenticate: Bearer realm="…",service="…",scope="…"` challenge of a 401, or null for any other scheme. */
export function parseBearerChallenge(header: string | undefined): BearerChallenge | null {
  if (!header || !/^Bearer\s/i.test(header)) return null;
  const params: Record<string, string> = {};
  for (const match of header.slice(7).matchAll(/([a-zA-Z]+)="([^"]*)"/g)) params[match[1].toLowerCase()] = match[2];
  if (!params.realm) return null;
  return { realm: params.realm, service: params.service, scope: params.scope };
}

type Descriptor = { digest?: unknown; size?: unknown; platform?: { architecture?: unknown; os?: unknown; variant?: unknown } };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
const sizeOf = (descriptor: unknown): number | null =>
  isRecord(descriptor) && Number.isSafeInteger(descriptor.size) && (descriptor.size as number) >= 0 ? (descriptor.size as number) : null;

/** The digest of the manifest for `architecture` (linux) in an image index, or null. */
export function platformManifestDigest(index: unknown, architecture: string): string | null {
  if (!isRecord(index) || !Array.isArray(index.manifests)) return null;
  const match = (index.manifests as Descriptor[]).find(
    (entry) => isRecord(entry) && entry.platform?.os === "linux" && entry.platform?.architecture === architecture,
  );
  return typeof match?.digest === "string" && DIGEST.test(match.digest) ? match.digest : null;
}

type Layer = { digest: string; size: number };
/** One platform's image as its manifest lists it: the config blob's size and the compressed layers. */
type PlatformImage = { configBytes: number; layers: Layer[] };

/** The config size and layers of an image manifest; null when it is not an image manifest. */
export function platformImage(manifest: unknown): PlatformImage | null {
  if (!isRecord(manifest) || !Array.isArray(manifest.layers) || manifest.layers.length === 0) return null;
  const layers: Layer[] = [];
  for (const layer of manifest.layers) {
    const size = sizeOf(layer);
    if (size === null || !isRecord(layer) || typeof layer.digest !== "string" || !DIGEST.test(layer.digest)) return null;
    layers.push({ digest: layer.digest, size });
  }
  return { configBytes: sizeOf(manifest.config) ?? 0, layers };
}

/** Compressed bytes of one platform's image: its layers plus its config; null when the manifest is not an image manifest. */
export function manifestDownloadBytes(manifest: unknown): number | null {
  const image = platformImage(manifest);
  return image && image.configBytes + image.layers.reduce((sum, layer) => sum + layer.size, 0);
}

/** The OCI architecture name of this host (the app and the updater run on the same Docker host). */
export function hostArchitecture(arch: string = process.arch): string {
  if (arch === "x64") return "amd64";
  if (arch === "ia32") return "386";
  return arch; // arm64, arm, ppc64, s390x, riscv64 match the OCI names
}

type Fetcher = (url: string, options: SafeFetchOptions) => Promise<SafeFetchResponse>;

/**
 * The sizes a pull needs: `downloadBytes`, the compressed bytes of the target
 * that the installed release does not share; `imageBytes`, the whole target.
 */
export type PullSizes = { downloadBytes: number; imageBytes: number };

/**
 * Pull sizes of `image:tag` for this host's platform, compared with
 * `image:installedTag` (the running release); null when the target cannot be
 * read (unknown image, private registry, offline, malformed). When the installed
 * release cannot be read, every layer counts as a download.
 */
export async function fetchPullSizes(
  image: string,
  tag: string,
  {
    installedTag,
    fetcher = safeFetch,
    architecture = hostArchitecture(),
  }: { installedTag?: string; fetcher?: Fetcher; architecture?: string } = {},
): Promise<PullSizes | null> {
  const location = parseImageRepository(image);
  if (!location || !TAG.test(tag)) return null;
  const { registry, repository } = location;
  const base = `https://${registry}/v2/${repository}/manifests/`;
  let token: string | null = null;

  async function getManifest(reference: string): Promise<unknown> {
    const request = () =>
      fetcher(base + reference, {
        headers: { Accept: ACCEPT, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxBytes: MAX_MANIFEST_BYTES,
      });
    let response = await request();
    if (response.status === 401 && token === null) {
      token = await fetchToken(parseBearerChallenge(response.headers["www-authenticate"]), repository, fetcher);
      if (token === null) return null;
      response = await request();
    }
    if (!response.ok) return null;
    return JSON.parse(response.text) as unknown;
  }

  async function imageFor(reference: string): Promise<PlatformImage | null> {
    try {
      const top = await getManifest(reference);
      const direct = platformImage(top);
      if (direct) return direct;
      const digest = platformManifestDigest(top, architecture);
      return digest ? platformImage(await getManifest(digest)) : null;
    } catch {
      return null;
    }
  }

  const target = await imageFor(tag);
  if (!target) return null;
  const installed = installedTag && TAG.test(installedTag) ? await imageFor(installedTag) : null;
  const present = new Set(installed?.layers.map((layer) => layer.digest));
  const total = (layers: Layer[]) => layers.reduce((sum, layer) => sum + layer.size, target.configBytes);
  return {
    downloadBytes: total(target.layers.filter((layer) => !present.has(layer.digest))),
    imageBytes: total(target.layers),
  };
}

/** An anonymous pull token from the registry's token service. */
async function fetchToken(challenge: BearerChallenge | null, repository: string, fetcher: Fetcher): Promise<string | null> {
  if (!challenge) return null;
  const url = new URL(challenge.realm);
  if (url.protocol !== "https:") return null;
  if (challenge.service) url.searchParams.set("service", challenge.service);
  url.searchParams.set("scope", challenge.scope ?? `repository:${repository}:pull`);
  const response = await fetcher(url.toString(), { timeoutMs: REQUEST_TIMEOUT_MS, maxBytes: 64 * 1024 });
  if (!response.ok) return null;
  const body = JSON.parse(response.text) as unknown;
  if (!isRecord(body)) return null;
  const token = body.token ?? body.access_token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** The image repository updates are pulled from: SERVIO_IMAGE, else the published one. */
export function servioImage(env: Record<string, string | undefined> = process.env): string {
  return env.SERVIO_IMAGE?.trim() || DEFAULT_SERVIO_IMAGE;
}
