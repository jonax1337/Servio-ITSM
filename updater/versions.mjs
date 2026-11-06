// Semantic version comparison (no dependencies): `X.Y.Z[-prerelease]`, optional leading `v`.
// A prerelease sorts before its release; build metadata is not supported.

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/**
 * @param {string} version
 * @returns {{ core: number[], prerelease: string[] } | null} null when not a semantic version
 */
function parse(version) {
  const match = SEMVER.exec(version);
  if (!match) return null;
  return { core: [match[1], match[2], match[3]].map(Number), prerelease: match[4] ? match[4].split(".") : [] };
}

/**
 * @param {string} a
 * @param {string} b
 */
function comparePrereleaseIdentifier(a, b) {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number | null} negative, 0 or positive like a sort comparator; null when either is not semver
 */
export function compareVersions(a, b) {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;

  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return Math.sign(left.core[index] - right.core[index]);
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return Math.sign(right.prerelease.length - left.prerelease.length);
  }
  const shared = Math.min(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < shared; index += 1) {
    const order = comparePrereleaseIdentifier(left.prerelease[index], right.prerelease[index]);
    if (order !== 0) return order;
  }
  return Math.sign(left.prerelease.length - right.prerelease.length);
}
