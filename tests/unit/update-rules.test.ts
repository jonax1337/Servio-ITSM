import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isNewerVersion,
  isValidVersion,
  parseReleases,
  stripVersionPrefix,
} from "@/lib/update-rules";

describe("isValidVersion / stripVersionPrefix", () => {
  it("accepts X.Y.Z with an optional v, prerelease and build suffix", () => {
    for (const v of ["1.2.3", "v1.2.3", "0.0.0", "10.20.30", "1.0.0-rc.1", "v1.0.0-alpha", "1.0.0+build.5", "1.0.0-rc.1+b"]) {
      expect(isValidVersion(v), v).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const v of ["", "latest", "1.2", "1.2.3.4", "v", "1.2.x", "1.2.3-", "a.b.c"]) {
      expect(isValidVersion(v), v).toBe(false);
    }
  });

  it("strips one leading v", () => {
    expect(stripVersionPrefix("v0.3.0")).toBe("0.3.0");
    expect(stripVersionPrefix("0.3.0")).toBe("0.3.0");
  });
});

describe("compareVersions", () => {
  it("orders by major, minor and patch numerically, not lexically", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareVersions("1.0.9", "1.0.10")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("ignores a leading v on either side", () => {
    expect(compareVersions("v1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("v1.2.4", "1.2.3")).toBe(1);
  });

  it("sorts a prerelease before its release", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareVersions("0.9.9", "1.0.0-rc.1")).toBe(-1);
  });

  it("orders prereleases by semver precedence", () => {
    const ascending = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let i = 0; i < ascending.length - 1; i++) {
      expect(compareVersions(ascending[i], ascending[i + 1]), `${ascending[i]} < ${ascending[i + 1]}`).toBe(-1);
      expect(compareVersions(ascending[i + 1], ascending[i])).toBe(1);
    }
  });

  it("ignores build metadata", () => {
    expect(compareVersions("1.0.0+a", "1.0.0+b")).toBe(0);
  });

  it("throws on a string that is not a version", () => {
    expect(() => compareVersions("latest", "1.0.0")).toThrow(/latest/);
  });
});

describe("isNewerVersion", () => {
  it("is true only for strictly newer versions", () => {
    expect(isNewerVersion("0.3.0", "0.2.0")).toBe(true);
    expect(isNewerVersion("v0.2.1", "0.2.0")).toBe(true);
    expect(isNewerVersion("0.2.0", "0.2.0")).toBe(false);
    expect(isNewerVersion("0.1.9", "0.2.0")).toBe(false);
  });

  it("treats a release as newer than its own prerelease and not the other way round", () => {
    expect(isNewerVersion("1.0.0", "1.0.0-rc.1")).toBe(true);
    expect(isNewerVersion("1.0.0-rc.1", "1.0.0")).toBe(false);
  });

  it("is false for junk on either side instead of throwing", () => {
    expect(isNewerVersion("nightly", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "unknown")).toBe(false);
  });
});

// A trimmed but realistic response of GET /repos/{owner}/{repo}/releases.
const GITHUB_RELEASES = [
  {
    url: "https://api.github.com/repos/jonax1337/Servio-ITSM/releases/300",
    html_url: "https://github.com/jonax1337/Servio-ITSM/releases/tag/v0.4.0",
    id: 300,
    tag_name: "v0.4.0",
    target_commitish: "main",
    name: "v0.4.0",
    draft: true,
    prerelease: false,
    created_at: "2026-11-05T09:00:00Z",
    published_at: null,
    body: "Draft that must never be offered.",
  },
  {
    html_url: "https://github.com/jonax1337/Servio-ITSM/releases/tag/v0.3.0-rc.1",
    id: 250,
    tag_name: "v0.3.0-rc.1",
    name: "v0.3.0-rc.1",
    draft: false,
    prerelease: true,
    published_at: "2026-11-01T10:00:00Z",
    body: "Release candidate.",
  },
  {
    html_url: "https://github.com/jonax1337/Servio-ITSM/releases/tag/v0.3.0",
    id: 240,
    tag_name: "v0.3.0",
    name: "Servio 0.3.0",
    draft: false,
    prerelease: false,
    published_at: "2026-11-03T10:00:00Z",
    body: "## Features\n\n* Self-update with maintenance windows",
  },
  {
    html_url: "https://github.com/jonax1337/Servio-ITSM/releases/tag/v0.2.0",
    id: 200,
    tag_name: "v0.2.0",
    name: "v0.2.0",
    draft: false,
    prerelease: false,
    published_at: "2026-10-20T10:00:00Z",
    body: "The version running now.",
  },
  {
    html_url: "https://github.com/jonax1337/Servio-ITSM/releases/tag/v0.1.0",
    id: 100,
    tag_name: "v0.1.0",
    name: null,
    draft: false,
    prerelease: false,
    published_at: "2026-10-01T10:00:00Z",
    body: null,
  },
  {
    html_url: "https://github.com/jonax1337/Servio-ITSM/releases/tag/nightly",
    id: 50,
    tag_name: "nightly",
    name: "Nightly",
    draft: false,
    prerelease: true,
    published_at: "2026-11-05T01:00:00Z",
    body: "Not a version.",
  },
  {
    html_url: "https://github.com/jonax1337/Servio-ITSM/releases/tag/v0.2.1",
    id: 210,
    tag_name: "v0.2.1",
    name: "v0.2.1",
    draft: false,
    prerelease: false,
    published_at: "2026-10-25T10:00:00Z",
    body: "Patch.",
  },
];

describe("parseReleases", () => {
  it("lists newer, published, stable releases newest first", () => {
    const releases = parseReleases(GITHUB_RELEASES, "0.2.0", { includePrereleases: false });
    expect(releases.map((r) => r.version)).toEqual(["0.3.0", "0.2.1"]);
  });

  it("maps GitHub's fields", () => {
    const [latest] = parseReleases(GITHUB_RELEASES, "0.2.0", { includePrereleases: false });
    expect(latest).toEqual({
      version: "0.3.0",
      name: "Servio 0.3.0",
      notes: "## Features\n\n* Self-update with maintenance windows",
      publishedAt: "2026-11-03T10:00:00Z",
      url: "https://github.com/jonax1337/Servio-ITSM/releases/tag/v0.3.0",
      prerelease: false,
    });
  });

  it("includes prereleases on request and sorts them before their release", () => {
    const releases = parseReleases(GITHUB_RELEASES, "0.2.0", { includePrereleases: true });
    expect(releases.map((r) => r.version)).toEqual(["0.3.0", "0.3.0-rc.1", "0.2.1"]);
    expect(releases[1].prerelease).toBe(true);
  });

  it("never offers drafts, non-version tags or the installed version", () => {
    const versions = parseReleases(GITHUB_RELEASES, "0.2.0", { includePrereleases: true }).map((r) => r.version);
    expect(versions).not.toContain("0.4.0");
    expect(versions).not.toContain("nightly");
    expect(versions).not.toContain("0.2.0");
    expect(versions).not.toContain("0.1.0");
  });

  it("falls back to the tag as name and to empty notes", () => {
    const releases = parseReleases(GITHUB_RELEASES, "0.0.1", { includePrereleases: false });
    expect(releases[releases.length - 1]).toMatchObject({ version: "0.1.0", name: "v0.1.0", notes: "" });
  });

  it("is empty when up to date, with no releases, or when GitHub answers with something else", () => {
    expect(parseReleases(GITHUB_RELEASES, "0.3.0", { includePrereleases: false })).toEqual([]);
    expect(parseReleases([], "0.2.0", { includePrereleases: true })).toEqual([]);
    expect(parseReleases({ message: "Not Found" }, "0.2.0", { includePrereleases: true })).toEqual([]);
    expect(parseReleases(null, "0.2.0", { includePrereleases: true })).toEqual([]);
  });

  it("skips malformed entries instead of failing", () => {
    const mixed = [null, "x", 42, { tag_name: 5 }, { tag_name: "v1.0.0", name: "ok", draft: false }];
    expect(parseReleases(mixed, "0.2.0", { includePrereleases: false }).map((r) => r.version)).toEqual(["1.0.0"]);
  });

  it("offers nothing when the installed version is not a version", () => {
    expect(parseReleases(GITHUB_RELEASES, "dev", { includePrereleases: false })).toEqual([]);
  });
});
