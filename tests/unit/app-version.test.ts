import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { APP_VERSION } from "@/lib/constants";
import { VERSION_FILES, isLater, parseVersion, versionMismatches } from "../../scripts/release.mjs";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");
const sources = () => Object.fromEntries(VERSION_FILES.map((f) => [f.path, read(f.path)]));

describe("APP_VERSION", () => {
  it("matches every file the release script bumps", () => {
    expect(versionMismatches(sources(), APP_VERSION)).toEqual([]);
  });

  it("lives in a file the release script bumps", () => {
    expect(VERSION_FILES.map((f) => f.path)).toEqual(["package.json", "updater/package.json", "lib/constants.ts"]);
  });
});

describe("release script", () => {
  it("writes a new version into every file and reads it back", () => {
    const bumped = Object.fromEntries(VERSION_FILES.map((f) => [f.path, f.write(read(f.path), "9.8.7")]));
    expect(versionMismatches(bumped, "9.8.7")).toEqual([]);
  });

  it("names each file that disagrees with the tag", () => {
    expect(versionMismatches(sources(), "9.9.9")).toEqual(VERSION_FILES.map((f) => `${f.path}: ${APP_VERSION}`));
  });

  it("only touches the version field of package.json", () => {
    const src = read("package.json");
    const bumped = VERSION_FILES[0].write(src, "9.8.7");
    expect({ ...JSON.parse(bumped), version: APP_VERSION }).toEqual(JSON.parse(src));
  });

  it("accepts release and prerelease versions and rejects the rest", () => {
    expect(parseVersion("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: null });
    expect(parseVersion("1.3.0-rc.1")?.prerelease).toBe("rc.1");
    for (const bad of ["v1.2.3", "1.2", "1.2.3.4", "01.2.3", "1.2.3-rc..1", "1.2.3-", "1.2.3-01", "latest", ""]) {
      expect(parseVersion(bad)).toBeNull();
    }
  });

  it.each([
    ["0.2.0", "0.1.0", true],
    ["0.1.1", "0.1.0", true],
    ["1.0.0", "0.9.9", true],
    ["0.1.0", "0.1.0", false],
    ["0.0.9", "0.1.0", false],
    ["0.2.0-rc.1", "0.1.0", true],
    ["0.2.0", "0.2.0-rc.1", true],
    ["0.2.0-rc.1", "0.2.0", false],
    ["0.2.0-rc.10", "0.2.0-rc.9", true],
    ["0.2.0-beta", "0.2.0-alpha.1", true],
  ])("isLater(%s, %s) is %s", (next, current, expected) => {
    expect(isLater(next, current)).toBe(expected);
  });
});
