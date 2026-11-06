import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { APP_VERSION } from "@/lib/constants";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), "utf8");

describe("APP_VERSION", () => {
  it("equals the package.json version", () => {
    expect((JSON.parse(read("package.json")) as { version: string }).version).toBe(APP_VERSION);
  });

  it("is bumped by release-please: annotated in constants.ts and listed as an extra file", () => {
    expect(read("lib/constants.ts")).toMatch(/export const APP_VERSION = "[^"]+"; \/\/ x-release-please-version/);
    const config = JSON.parse(read("release-please-config.json")) as { packages: Record<string, { "extra-files"?: string[] }> };
    expect(config.packages["."]["extra-files"]).toContain("lib/constants.ts");
  });
});
