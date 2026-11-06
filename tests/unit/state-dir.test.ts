import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readJsonFile, stateDir, statePath, writeJsonAtomic } from "@/lib/state-dir";

let dir: string;
const originalStateDir = process.env.SERVIO_STATE_DIR;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "servio-state-"));
  process.env.SERVIO_STATE_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (originalStateDir === undefined) delete process.env.SERVIO_STATE_DIR;
  else process.env.SERVIO_STATE_DIR = originalStateDir;
});

describe("stateDir", () => {
  it("uses SERVIO_STATE_DIR", () => {
    expect(stateDir()).toBe(path.resolve(dir));
    expect(statePath("updater", "status.json")).toBe(path.join(path.resolve(dir), "updater", "status.json"));
  });

  it("defaults to .servio-state in the working directory", () => {
    delete process.env.SERVIO_STATE_DIR;
    expect(stateDir()).toBe(path.resolve(".servio-state"));
    process.env.SERVIO_STATE_DIR = "   ";
    expect(stateDir()).toBe(path.resolve(".servio-state"));
  });
});

describe("readJsonFile", () => {
  it("reads valid JSON", () => {
    writeFileSync(path.join(dir, "a.json"), '{"active":true}');
    expect(readJsonFile(path.join(dir, "a.json"))).toEqual({ active: true });
  });

  it("treats a missing file as absent", () => {
    expect(readJsonFile(path.join(dir, "missing.json"))).toBeNull();
  });

  it("treats a half-written file as absent", () => {
    writeFileSync(path.join(dir, "half.json"), '{"active":tr');
    expect(readJsonFile(path.join(dir, "half.json"))).toBeNull();
  });
});

describe("writeJsonAtomic", () => {
  it("creates missing directories and round-trips the value", () => {
    const file = statePath("updater", "request.json");
    writeJsonAtomic(file, { id: "w1", targetVersion: "0.3.0" });
    expect(readJsonFile(file)).toEqual({ id: "w1", targetVersion: "0.3.0" });
  });

  it("replaces an existing file and leaves no temp file behind", () => {
    const file = path.join(dir, "maintenance.json");
    writeJsonAtomic(file, { active: true });
    writeJsonAtomic(file, { active: false });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ active: false });
    expect(readdirSync(dir)).toEqual(["maintenance.json"]);
  });
});
