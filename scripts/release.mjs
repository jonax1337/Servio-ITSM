// Cuts a release: `pnpm release 0.2.0` writes the version into every file that
// carries it, commits and creates the annotated tag v0.2.0. Pushing the tag
// (`git push --follow-tags origin main`) starts .github/workflows/release.yml.
// The workflow runs `node scripts/release.mjs --check v0.2.0` first, so a tag
// whose files disagree never builds. See docs/releasing.md.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareVersions } from "../updater/versions.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
// Semantic Versioning 2.0 without build metadata: no leading zeros, no empty prerelease identifiers.
const NUMBER = String.raw`(0|[1-9]\d*)`;
const PRERELEASE_ID = String.raw`(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER = new RegExp(String.raw`^${NUMBER}\.${NUMBER}\.${NUMBER}(?:-(${PRERELEASE_ID}(?:\.${PRERELEASE_ID})*))?$`);
const APP_VERSION_LINE = /export const APP_VERSION = "([^"]*)";/;

/** Every file that carries the release version, with how to read and write it. */
export const VERSION_FILES = [
  { path: "package.json", ...jsonVersion() },
  { path: "updater/package.json", ...jsonVersion() },
  {
    path: "lib/constants.ts",
    read: (src) => src.match(APP_VERSION_LINE)?.[1] ?? null,
    write: (src, version) => src.replace(APP_VERSION_LINE, `export const APP_VERSION = "${version}";`),
  },
];

function jsonVersion() {
  return {
    read: (src) => JSON.parse(src).version ?? null,
    write: (src, version) => src.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`),
  };
}

export function parseVersion(text) {
  const match = SEMVER.exec(text);
  if (!match) return null;
  const [, major, minor, patch, prerelease] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch), prerelease: prerelease ?? null };
}

/** True when `next` is a later version than `current`, ordered exactly as the updater orders releases. */
export function isLater(next, current) {
  return compareVersions(next, current) > 0;
}

/** The files whose version differs from `expected`, as "path: found" lines. */
export function versionMismatches(sources, expected) {
  return VERSION_FILES
    .map((file) => ({ path: file.path, found: file.read(sources[file.path]) }))
    .filter(({ found }) => found !== expected)
    .map(({ path, found }) => `${path}: ${found ?? "no version found"}`);
}

const readSources = () => Object.fromEntries(VERSION_FILES.map((f) => [f.path, readFileSync(ROOT + f.path, "utf8")]));
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function check(tag) {
  const version = tag.replace(/^v/, "");
  if (!parseVersion(version)) fail(`"${tag}" is not a vX.Y.Z tag`);
  const mismatches = versionMismatches(readSources(), version);
  if (mismatches.length) fail(`tag ${tag} does not match:\n  ${mismatches.join("\n  ")}\nRun \`pnpm release ${version}\` instead of tagging by hand.`);
  console.log(`release: all version files are ${version}`);
}

function cut(version) {
  if (!parseVersion(version)) fail(`"${version}" is not a version like 1.2.3 or 1.3.0-rc.1`);
  if (git("branch", "--show-current") !== "main") fail("releases are cut from main");
  if (git("status", "--porcelain")) fail("the working tree has uncommitted changes");
  const tag = `v${version}`;
  if (git("tag", "--list", tag)) fail(`tag ${tag} already exists`);
  const sources = readSources();
  const current = VERSION_FILES[0].read(sources["package.json"]);
  if (!isLater(version, current)) fail(`${version} is not later than the current version ${current}`);

  const paths = VERSION_FILES.map((f) => f.path);
  for (const file of VERSION_FILES) writeFileSync(ROOT + file.path, file.write(sources[file.path], version));
  try {
    const mismatches = versionMismatches(readSources(), version);
    if (mismatches.length) throw new Error(`could not write the version into:\n  ${mismatches.join("\n  ")}`);
    // [skip-docs]: the version bump is not a documentation change for the doc-drift hook.
    git("add", ...paths);
    git("commit", "-m", `chore(release): ${tag} [skip-docs]`);
  } catch (error) {
    git("reset", "-q", "--", ...paths);
    git("checkout", "--", ...paths);
    fail(`${error.message}\nThe version files were restored; nothing was committed or tagged.`);
  }
  git("tag", "-a", tag, "-m", `Servio ${tag}`);
  console.log(`release: committed and tagged ${tag}. Publish it with:\n  git push --follow-tags origin main`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [arg, value] = process.argv.slice(2);
  if (arg === "--check" && value) check(value);
  else if (arg && !arg.startsWith("-")) cut(arg);
  else fail("usage: pnpm release <version>   |   node scripts/release.mjs --check <tag>");
}
