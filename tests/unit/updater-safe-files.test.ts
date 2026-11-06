import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackup, restoreBackup } from "../../updater/backup.mjs";
import { loadConfig } from "../../updater/config.mjs";
import { createHeartbeat } from "../../updater/heartbeat.mjs";
import { UnsafeFileError, copyRegularFile, readRegularFile } from "../../updater/safe-fs.mjs";
import { MAX_SMALL_JSON_BYTES, ensureDirectory, statePaths, writeJsonAtomic } from "../../updater/state-files.mjs";
import { compareVersions } from "../../updater/versions.mjs";
import {
  FRESH_REQUESTED_AT,
  IMAGE_REPO,
  NEW_VERSION,
  OLD_DB,
  FakeDocker,
  createHarness,
  servioContainer,
  type Harness,
} from "./updater-test-kit";

const REQUEST = { id: "win-1", targetVersion: NEW_VERSION, requestedAt: FRESH_REQUESTED_AT, requestedBy: "admin@x" };

/** Creating file symlinks needs a privilege on Windows; those tests are skipped where it is missing. */
async function probeFileSymlinks() {
  const dir = await mkdtemp(join(tmpdir(), "servio-probe-"));
  try {
    await writeFile(join(dir, "target"), "x");
    await symlink(join(dir, "target"), join(dir, "link"), "file");
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const itWithSymlinks = it.skipIf(!(await probeFileSymlinks()));

let harness: Harness;
let outside: string;
beforeEach(async () => {
  harness = await createHarness();
  outside = await mkdtemp(join(tmpdir(), "servio-outside-"));
});
afterEach(async () => {
  await harness.cleanup();
  await rm(outside, { recursive: true, force: true });
});

const requestFile = () => join(harness.stateDir, "updater", "request.json");
const statusFile = () => join(harness.stateDir, "updater", "status.json");

async function runUpdate() {
  await harness.writeRequest(REQUEST);
  await harness.flow.processPendingRequest();
}

/** A directory where a file is expected stands in for any "not a regular file" case. */
async function replaceWithDirectory(path: string) {
  await rm(path, { force: true });
  await mkdir(path);
}

async function replaceWithSymlink(path: string, targetName: string) {
  const target = join(outside, targetName);
  await writeFile(target, "victim");
  await rm(path, { force: true });
  await symlink(target, path, "file");
  return target;
}

describe("database files that are not regular files (finding 1)", () => {
  it.each([["database", ""], ["WAL", "-wal"], ["SHM", "-shm"]])("refuses a directory in place of the %s before stopping anything", async (_label, suffix) => {
    await replaceWithDirectory(harness.dbFile + suffix);
    await runUpdate();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("is not a regular file");
    expect(harness.docker.callsTo("stop")).toEqual([]);
    expect(await readdir(harness.backupDir)).toEqual([]);
  });

  itWithSymlinks.each([["database", ""], ["WAL", "-wal"]])("refuses a symlink in place of the %s and never reads through it", async (_label, suffix) => {
    const victim = await replaceWithSymlink(harness.dbFile + suffix, "victim.bin");
    await runUpdate();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("not a regular file");
    expect(harness.docker.callsTo("stop")).toEqual([]);
    expect(await readFile(victim, "utf8")).toBe("victim");
    expect(await readdir(harness.backupDir)).toEqual([]);
  });

  itWithSymlinks("replaces a symlink planted at the database path during the update instead of writing through it", async () => {
    harness.docker.newContainerPlan = "never-healthy";
    const victim = join(outside, "victim.bin");
    await writeFile(victim, "victim");
    harness.docker.onStart = async (container) => {
      if (!container.Id.startsWith("new-")) return;
      await rm(harness.dbFile);
      await symlink(victim, harness.dbFile, "file");
    };
    await runUpdate();

    expect((await harness.readStatus()).state).toBe("ROLLED_BACK");
    expect(await readFile(victim, "utf8")).toBe("victim");
    expect(await readFile(harness.dbFile)).toEqual(OLD_DB);
  });

  it("refuses to copy a backup when the backup directory is a symlink or junction", async () => {
    const elsewhere = join(outside, "elsewhere");
    await mkdir(elsewhere);
    await rm(harness.backupDir, { recursive: true });
    await symlink(elsewhere, harness.backupDir, "junction");
    await runUpdate();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("is not a real directory");
    expect(harness.docker.callsTo("stop")).toEqual([]);
    expect(await readdir(elsewhere)).toEqual([]);
  });
});

describe("request and status files (finding 1)", () => {
  it("ignores a request.json that is a directory", async () => {
    await replaceWithDirectory(requestFile());

    expect(await harness.flow.processPendingRequest()).toBe("ignored");
    expect(harness.docker.calls).toEqual([]);
    expect(harness.logLines.some((line) => line.includes("not a regular file"))).toBe(true);
  });

  itWithSymlinks("ignores a request.json that is a symlink", async () => {
    await replaceWithSymlink(requestFile(), "request.json");

    expect(await harness.flow.processPendingRequest()).toBe("ignored");
    expect(harness.docker.calls).toEqual([]);
  });

  it("ignores a request.json larger than 64 KB", async () => {
    await harness.writeRequest({ ...REQUEST, padding: "x".repeat(MAX_SMALL_JSON_BYTES) });

    expect(await harness.flow.processPendingRequest()).toBe("ignored");
    expect(harness.docker.calls).toEqual([]);
    expect(harness.logLines.some((line) => line.includes("larger than 65536 bytes"))).toBe(true);
  });

  it("still accepts a request just below the limit", async () => {
    await harness.writeRequest({ ...REQUEST, padding: "x".repeat(MAX_SMALL_JSON_BYTES - 1000) });

    expect(await harness.flow.processPendingRequest()).toBe("processed");
    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
  });

  it("fails closed when status.json is not a regular file instead of replaying the request", async () => {
    await harness.writeRequest(REQUEST);
    await replaceWithDirectory(statusFile());

    expect(await harness.flow.processPendingRequest()).toBe("ignored");
    expect(harness.docker.calls).toEqual([]);
  });
});

describe("safe file primitives (finding 1)", () => {
  it("copyRegularFile writes only to a destination that does not exist yet", async () => {
    const source = join(outside, "source");
    const destination = join(outside, "destination");
    await writeFile(source, "new");
    await writeFile(destination, "precious");

    await expect(copyRegularFile(source, destination)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(destination, "utf8")).toBe("precious");
  });

  itWithSymlinks("copyRegularFile does not write through a symlink at the destination", async () => {
    const source = join(outside, "source");
    await writeFile(source, "new");
    const victim = await replaceWithSymlink(join(outside, "destination"), "victim.bin");

    await expect(copyRegularFile(source, join(outside, "destination"))).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(victim, "utf8")).toBe("victim");
  });

  it("copyRegularFile copies files larger than its chunk size byte for byte", async () => {
    const source = join(outside, "big");
    const payload = Buffer.alloc(2_500_000, "servio");
    await writeFile(source, payload);

    await copyRegularFile(source, join(outside, "copy"));

    expect((await readFile(join(outside, "copy"))).equals(payload)).toBe(true);
  });

  it("copyRegularFile refuses a directory source", async () => {
    await expect(copyRegularFile(outside, join(outside, "copy"))).rejects.toBeInstanceOf(UnsafeFileError);
  });

  it("readRegularFile returns null for a missing file and rejects directories and oversize files", async () => {
    expect(await readRegularFile(join(outside, "missing"), 10)).toBeNull();
    await expect(readRegularFile(outside, 10)).rejects.toBeInstanceOf(UnsafeFileError);
    await writeFile(join(outside, "big"), "12345678901");
    await expect(readRegularFile(join(outside, "big"), 10)).rejects.toThrow("larger than 10 bytes");
    await writeFile(join(outside, "ok"), "1234567890");
    expect(await readRegularFile(join(outside, "ok"), 10)).toBe("1234567890");
  });

  it("createBackup never overwrites an existing backup file", async () => {
    const at = new Date("2026-11-06T10:00:00Z");
    await createBackup({ dbFile: harness.dbFile, backupDir: harness.backupDir, fromVersion: "0.2.0", at });

    await expect(createBackup({ dbFile: harness.dbFile, backupDir: harness.backupDir, fromVersion: "0.2.0", at })).rejects.toMatchObject({
      code: "EEXIST",
    });
  });

  it("restoreBackup swaps in the restored file via a temp file and leaves no temp files behind", async () => {
    const backup = await createBackup({ dbFile: harness.dbFile, backupDir: harness.backupDir, fromVersion: "0.2.0", at: new Date() });
    await writeFile(harness.dbFile, "migrated");

    await restoreBackup(harness.dbFile, backup);

    expect(await readFile(harness.dbFile)).toEqual(OLD_DB);
    const dataDir = join(harness.dbFile, "..");
    expect((await readdir(dataDir)).filter((name) => name.includes(".restore-"))).toEqual([]);
  });

  itWithSymlinks("restoreBackup replaces a symlink at the database path rather than writing through it", async () => {
    const backup = await createBackup({ dbFile: harness.dbFile, backupDir: harness.backupDir, fromVersion: "0.2.0", at: new Date() });
    const victim = await replaceWithSymlink(harness.dbFile, "victim.bin");

    await restoreBackup(harness.dbFile, backup);

    expect(await readFile(victim, "utf8")).toBe("victim");
    expect(await readFile(harness.dbFile)).toEqual(OLD_DB);
  });

  it("refuses to write state files through a symlinked or junctioned directory", async () => {
    const elsewhere = join(outside, "elsewhere");
    await mkdir(elsewhere);
    const linkedDir = join(outside, "linked");
    await symlink(elsewhere, linkedDir, "junction");

    await expect(writeJsonAtomic(join(linkedDir, "status.json"), { a: 1 })).rejects.toBeInstanceOf(UnsafeFileError);
    await expect(ensureDirectory(linkedDir)).rejects.toBeInstanceOf(UnsafeFileError);
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it("refuses to write the heartbeat when the updater directory was swapped for a symlink", async () => {
    const elsewhere = join(outside, "elsewhere");
    await mkdir(elsewhere);
    await rm(join(harness.stateDir, "updater"), { recursive: true });
    await symlink(elsewhere, join(harness.stateDir, "updater"), "junction");
    const docker = new FakeDocker();
    docker.add(servioContainer());
    const beat = createHeartbeat({ docker: docker.asClient(), config: harness.config, paths: statePaths(harness.stateDir), log: () => {} });

    await expect(beat()).rejects.toBeInstanceOf(UnsafeFileError);
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it("writes JSON through uniquely named exclusive temp files", async () => {
    const target = join(outside, "state.json");
    await writeJsonAtomic(target, { n: 1 });
    await writeJsonAtomic(target, { n: 2 });

    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ n: 2 });
    expect(await readdir(outside)).toEqual(["state.json"]);
    expect((await stat(target)).isFile()).toBe(true);
  });
});

describe("compareVersions", () => {
  it.each([
    ["0.3.0", "0.2.0", 1],
    ["0.2.0", "0.3.0", -1],
    ["1.0.0", "1.0.0", 0],
    ["v1.2.3", "1.2.3", 0],
    ["0.10.0", "0.9.0", 1],
    ["1.0.0", "1.0.0-rc.1", 1],
    ["1.0.0-rc.1", "1.0.0", -1],
    ["1.0.0-rc.2", "1.0.0-rc.10", -1],
    ["1.0.0-alpha", "1.0.0-alpha.1", -1],
    ["1.0.0-alpha.1", "1.0.0-beta", -1],
    ["1.0.0-1", "1.0.0-alpha", -1],
    ["2.0.0-rc.1", "1.9.9", 1],
  ])("%s vs %s is %i", (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it.each([["latest", "1.0.0"], ["1.0", "1.0.0"], ["1.0.0", "main"], ["", "1.0.0"]])("is null when %s or %s is not a semantic version", (a, b) => {
    expect(compareVersions(a, b)).toBeNull();
  });
});

describe("Docker endpoint configuration", () => {
  const env = (extra: Record<string, string>) => loadConfig({ SERVIO_IMAGE: IMAGE_REPO, ...extra });

  it("connects through a socket proxy over TCP when DOCKER_HOST is set", () => {
    expect(env({ DOCKER_HOST: "tcp://docker-proxy:2375" }).dockerEndpoint).toEqual({ host: "docker-proxy", port: 2375 });
    expect(env({ DOCKER_HOST: "tcp://10.0.0.5:2376" }).dockerEndpoint).toEqual({ host: "10.0.0.5", port: 2376 });
    expect(env({ DOCKER_HOST: "tcp://[::1]:2375" }).dockerEndpoint).toEqual({ host: "::1", port: 2375 });
  });

  it("falls back to the proxy's default port 2375", () => {
    expect(env({ DOCKER_HOST: "tcp://docker-proxy" }).dockerEndpoint).toEqual({ host: "docker-proxy", port: 2375 });
  });

  it("prefers DOCKER_HOST over DOCKER_SOCKET and uses the socket otherwise", () => {
    expect(env({ DOCKER_HOST: "tcp://p:2375", DOCKER_SOCKET: "/run/docker.sock" }).dockerEndpoint).toEqual({ host: "p", port: 2375 });
    expect(env({ DOCKER_SOCKET: "/run/docker.sock" }).dockerEndpoint).toEqual({ socketPath: "/run/docker.sock" });
  });

  it.each(["unix:///var/run/docker.sock", "http://docker-proxy:2375", "docker-proxy:2375", "ssh://host"])("rejects DOCKER_HOST=%s", (value) => {
    expect(() => env({ DOCKER_HOST: value })).toThrow("DOCKER_HOST");
  });

  it("reads the new limits and flags", () => {
    const config = env({ ALLOW_DOWNGRADE: "true", PULL_TIMEOUT_SECONDS: "60", REQUEST_MAX_AGE_SECONDS: "120" });

    expect(config).toMatchObject({ allowDowngrade: true, pullTimeoutMs: 60_000, requestMaxAgeMs: 120_000 });
    expect(() => env({ PULL_TIMEOUT_SECONDS: "0" })).toThrow("PULL_TIMEOUT_SECONDS");
  });
});
