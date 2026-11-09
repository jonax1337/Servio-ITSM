import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERVIO_IMAGE,
  fetchImageDownloadBytes,
  hostArchitecture,
  manifestDownloadBytes,
  parseBearerChallenge,
  parseImageRepository,
  platformManifestDigest,
  servioImage,
} from "@/lib/registry-manifest";
import type { SafeFetchOptions, SafeFetchResponse } from "@/lib/safe-fetch";

const AMD64 = `sha256:${"a".repeat(64)}`;
const ARM64 = `sha256:${"b".repeat(64)}`;
const index = {
  mediaType: "application/vnd.oci.image.index.v1+json",
  manifests: [
    { digest: AMD64, size: 1000, platform: { os: "linux", architecture: "amd64" } },
    { digest: ARM64, size: 1000, platform: { os: "linux", architecture: "arm64" } },
    { digest: `sha256:${"c".repeat(64)}`, size: 500, platform: { os: "unknown", architecture: "unknown" } },
  ],
};
const manifest = (layers: number[]) => ({
  mediaType: "application/vnd.oci.image.manifest.v1+json",
  config: { digest: `sha256:${"d".repeat(64)}`, size: 100 },
  layers: layers.map((size, n) => ({ digest: `sha256:${String(n).repeat(64)}`, size })),
});

const respond = (status: number, body: unknown, headers: Record<string, string> = {}): SafeFetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers,
  text: JSON.stringify(body),
});

describe("parseImageRepository", () => {
  it("splits registry and repository", () => {
    expect(parseImageRepository("ghcr.io/owner/servio")).toEqual({ registry: "ghcr.io", repository: "owner/servio" });
    expect(parseImageRepository("registry.local:5000/team/servio")).toEqual({ registry: "registry.local:5000", repository: "team/servio" });
  });

  it("adds Docker Hub's implicit host and library namespace", () => {
    expect(parseImageRepository("owner/servio")).toEqual({ registry: "registry-1.docker.io", repository: "owner/servio" });
    expect(parseImageRepository("servio")).toEqual({ registry: "registry-1.docker.io", repository: "library/servio" });
  });

  it("refuses malformed names", () => {
    for (const bad of ["", "ghcr.io/", "ghcr.io/Owner/Servio", "ghcr.io/owner/servio:1.0", "a b/c", "ghcr.io/owner/../x"]) {
      expect(parseImageRepository(bad)).toBeNull();
    }
  });
});

describe("parseBearerChallenge", () => {
  it("reads realm, service and scope", () => {
    expect(parseBearerChallenge('Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:owner/servio:pull"')).toEqual({
      realm: "https://ghcr.io/token",
      service: "ghcr.io",
      scope: "repository:owner/servio:pull",
    });
  });

  it("ignores other schemes and challenges without a realm", () => {
    expect(parseBearerChallenge('Basic realm="x"')).toBeNull();
    expect(parseBearerChallenge('Bearer service="x"')).toBeNull();
    expect(parseBearerChallenge(undefined)).toBeNull();
  });
});

describe("manifests", () => {
  it("adds the compressed layers and the config", () => {
    expect(manifestDownloadBytes(manifest([1000, 2000, 3000]))).toBe(6100);
  });

  it("is null for an index or a manifest with a malformed layer", () => {
    expect(manifestDownloadBytes(index)).toBeNull();
    expect(manifestDownloadBytes({ layers: [{ size: -1 }] })).toBeNull();
    expect(manifestDownloadBytes({ layers: [] })).toBeNull();
    expect(manifestDownloadBytes(null)).toBeNull();
  });

  it("picks the linux manifest for the host architecture", () => {
    expect(platformManifestDigest(index, "amd64")).toBe(AMD64);
    expect(platformManifestDigest(index, "arm64")).toBe(ARM64);
    expect(platformManifestDigest(index, "s390x")).toBeNull();
    expect(platformManifestDigest({ manifests: [{ digest: "not-a-digest", platform: { os: "linux", architecture: "amd64" } }] }, "amd64")).toBeNull();
  });

  it("maps Node's architecture names to OCI names", () => {
    expect(hostArchitecture("x64")).toBe("amd64");
    expect(hostArchitecture("arm64")).toBe("arm64");
    expect(hostArchitecture("ia32")).toBe("386");
  });
});

describe("fetchImageDownloadBytes", () => {
  function registry(routes: Record<string, (options: SafeFetchOptions) => SafeFetchResponse>) {
    const calls: Array<{ url: string; options: SafeFetchOptions }> = [];
    const fetcher = async (url: string, options: SafeFetchOptions) => {
      calls.push({ url, options });
      const route = routes[url];
      if (!route) return respond(404, { errors: [] });
      return route(options);
    };
    return { calls, fetcher };
  }
  const base = "https://ghcr.io/v2/owner/servio/manifests/";

  it("follows the index to this platform's manifest with an anonymous token", async () => {
    const authorized = (options: SafeFetchOptions) => options.headers?.Authorization === "Bearer anon";
    const { calls, fetcher } = registry({
      [`${base}1.2.3`]: (options) =>
        authorized(options)
          ? respond(200, index)
          : respond(401, {}, { "www-authenticate": 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:owner/servio:pull"' }),
      "https://ghcr.io/token?service=ghcr.io&scope=repository%3Aowner%2Fservio%3Apull": () => respond(200, { token: "anon" }),
      [`${base}${ARM64}`]: (options) => (authorized(options) ? respond(200, manifest([500, 700])) : respond(401, {})),
    });

    expect(await fetchImageDownloadBytes("ghcr.io/owner/servio", "1.2.3", { fetcher, architecture: "arm64" })).toBe(1300);
    expect(calls.map((call) => call.url)).toEqual([
      `${base}1.2.3`,
      "https://ghcr.io/token?service=ghcr.io&scope=repository%3Aowner%2Fservio%3Apull",
      `${base}1.2.3`,
      `${base}${ARM64}`,
    ]);
    expect(calls[0].options.headers?.Accept).toContain("application/vnd.oci.image.index.v1+json");
  });

  it("reads a single-platform manifest directly", async () => {
    const { fetcher } = registry({ [`${base}1.2.3`]: () => respond(200, manifest([42])) });
    expect(await fetchImageDownloadBytes("ghcr.io/owner/servio", "1.2.3", { fetcher })).toBe(142);
  });

  it("returns null when the registry cannot tell: unknown tag, refused token, missing platform, network error, bad input", async () => {
    expect(await fetchImageDownloadBytes("ghcr.io/owner/servio", "9.9.9", registry({}))).toBeNull();
    const refused = registry({
      [`${base}1.2.3`]: () => respond(401, {}, { "www-authenticate": 'Bearer realm="https://ghcr.io/token"' }),
      "https://ghcr.io/token?scope=repository%3Aowner%2Fservio%3Apull": () => respond(403, {}),
    });
    expect(await fetchImageDownloadBytes("ghcr.io/owner/servio", "1.2.3", refused)).toBeNull();
    const plainHttpRealm = registry({
      [`${base}1.2.3`]: () => respond(401, {}, { "www-authenticate": 'Bearer realm="http://ghcr.io/token"' }),
    });
    expect(await fetchImageDownloadBytes("ghcr.io/owner/servio", "1.2.3", plainHttpRealm)).toBeNull();
    const noPlatform = registry({ [`${base}1.2.3`]: () => respond(200, index) });
    expect(await fetchImageDownloadBytes("ghcr.io/owner/servio", "1.2.3", { ...noPlatform, architecture: "s390x" })).toBeNull();
    const offline = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    expect(await fetchImageDownloadBytes("ghcr.io/owner/servio", "1.2.3", { fetcher: offline })).toBeNull();
    expect(await fetchImageDownloadBytes("not a repo", "1.2.3", registry({}))).toBeNull();
    expect(await fetchImageDownloadBytes("ghcr.io/owner/servio", "../x", registry({}))).toBeNull();
  });
});

describe("servioImage", () => {
  it("uses SERVIO_IMAGE when set, else the published image", () => {
    expect(servioImage({})).toBe(DEFAULT_SERVIO_IMAGE);
    expect(servioImage({ SERVIO_IMAGE: " registry.local/servio " })).toBe("registry.local/servio");
  });
});
