/**
 * Pure rules for Servio's self-update: semver comparison and turning GitHub's
 * releases JSON into the list of releases newer than the running version.
 * No I/O: lib/updates.ts fetches, these functions decide.
 */

type ParsedVersion = { core: [number, number, number]; prerelease: string[] };

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(version.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

/** True for `X.Y.Z` with an optional leading `v`, prerelease and build suffix. */
export const isValidVersion = (version: string): boolean => parseVersion(version) !== null;

/** `v0.3.0` -> `0.3.0`. */
export const stripVersionPrefix = (version: string): string => version.trim().replace(/^v/, "");

const isNumeric = (identifier: string): boolean => /^\d+$/.test(identifier);

/** Semver precedence of two prerelease identifiers: numbers sort before words, each compared on its own terms. */
function compareIdentifier(a: string, b: string): number {
  if (isNumeric(a) && isNumeric(b)) return Math.sign(Number(a) - Number(b));
  if (isNumeric(a)) return -1;
  if (isNumeric(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePrerelease(a: string[], b: string[]): number {
  // A release (no prerelease part) sorts after any prerelease of the same core version.
  if (a.length === 0 || b.length === 0) return Math.sign(b.length - a.length);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = compareIdentifier(a[i], b[i]);
    if (order !== 0) return order;
  }
  return Math.sign(a.length - b.length);
}

/** -1, 0 or 1 by semver precedence. Throws on a string that is not a version: callers validate first. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`Cannot compare versions "${a}" and "${b}"`);
  for (let i = 0; i < left.core.length; i++) {
    if (left.core[i] !== right.core[i]) return Math.sign(left.core[i] - right.core[i]);
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

/** False when either side is not a version, so junk tags never count as updates. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return isValidVersion(candidate) && isValidVersion(current) && compareVersions(candidate, current) > 0;
}

export type AvailableRelease = {
  /** Without the leading `v`. */
  version: string;
  name: string;
  /** Markdown release notes. */
  notes: string;
  publishedAt: string | null;
  url: string;
  prerelease: boolean;
};

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

function toRelease(entry: unknown): AvailableRelease | null {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as Record<string, unknown>;
  const tag = asString(raw.tag_name);
  if (raw.draft === true || !isValidVersion(tag)) return null;
  const version = stripVersionPrefix(tag);
  return {
    version,
    name: asString(raw.name) || `v${version}`,
    notes: asString(raw.body),
    publishedAt: asString(raw.published_at) || null,
    url: asString(raw.html_url),
    prerelease: raw.prerelease === true,
  };
}

/** Releases of GitHub's `/releases` JSON that are newer than `currentVersion`, newest first. Drafts and malformed entries are dropped. */
export function parseReleases(
  githubJson: unknown,
  currentVersion: string,
  options: { includePrereleases: boolean },
): AvailableRelease[] {
  if (!Array.isArray(githubJson)) return [];
  return githubJson
    .map(toRelease)
    .filter((release): release is AvailableRelease => release !== null)
    .filter((release) => options.includePrereleases || !release.prerelease)
    .filter((release) => isNewerVersion(release.version, currentVersion))
    .sort((a, b) => compareVersions(b.version, a.version));
}
