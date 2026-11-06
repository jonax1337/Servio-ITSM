import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../updater/config.mjs";
import { isLivenessFresh } from "../../updater/healthcheck.mjs";
import { createHeartbeat, livenessFile } from "../../updater/heartbeat.mjs";
import { MAX_SMALL_JSON_BYTES, readJsonFile, statePaths, writeJsonAtomic } from "../../updater/state-files.mjs";
import { CONTAINER_NAME, IMAGE_REPO, OLD_VERSION, FakeDocker, servioContainer } from "./updater-test-kit";

let root: string;
let heartbeatFile: string;
const NOW = Date.parse("2026-11-06T10:00:00Z");

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "servio-heartbeat-"));
  heartbeatFile = join(root, "updater", "heartbeat.json");
  await mkdir(join(root, "updater"));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const config = (env: Record<string, string> = {}) =>
  loadConfig({ SERVIO_IMAGE: IMAGE_REPO, SERVIO_CONTAINER: CONTAINER_NAME, BACKUP_DIR: root, ...env });

function heartbeatFor(docker: FakeDocker, logLines: string[] = []) {
  return createHeartbeat({
    docker: docker.asClient(),
    config: config(),
    paths: statePaths(root),
    now: () => NOW,
    log: (line) => logLines.push(line),
  });
}

describe("heartbeat", () => {
  it("reports Docker as reachable with the managed container and its image", async () => {
    const docker = new FakeDocker();
    docker.add(servioContainer());

    await heartbeatFor(docker)();

    expect(await readJsonFile(heartbeatFile, MAX_SMALL_JSON_BYTES)).toEqual({
      updaterVersion: config().updaterVersion,
      at: "2026-11-06T10:00:00.000Z",
      dockerOk: true,
      container: CONTAINER_NAME,
      image: `${IMAGE_REPO}:${OLD_VERSION}`,
    });
  });

  it("still writes the file with dockerOk false when ping fails, and logs the outage once", async () => {
    const docker = new FakeDocker();
    docker.add(servioContainer());
    docker.failOn("ping", new Error("connect ENOENT /var/run/docker.sock"));
    const logLines: string[] = [];
    const beat = heartbeatFor(docker, logLines);

    await beat();
    await beat();

    expect(await readJsonFile(heartbeatFile, MAX_SMALL_JSON_BYTES)).toMatchObject({ dockerOk: false, container: CONTAINER_NAME, image: null });
    expect(logLines).toHaveLength(1);
    expect(logLines[0]).toContain("ENOENT");
  });

  it("logs when Docker comes back", async () => {
    const docker = new FakeDocker();
    docker.failOn("ping", new Error("down"), () => docker.callsTo("ping").length <= 1);
    const logLines: string[] = [];
    const beat = heartbeatFor(docker, logLines);

    await beat();
    await beat();

    expect(await readJsonFile(heartbeatFile, MAX_SMALL_JSON_BYTES)).toMatchObject({ dockerOk: true });
    expect(logLines.at(-1)).toContain("reachable again");
  });

  it("writes the heartbeat even when the managed container cannot be found", async () => {
    await heartbeatFor(new FakeDocker())();

    expect(await readJsonFile(heartbeatFile, MAX_SMALL_JSON_BYTES)).toMatchObject({ dockerOk: true, container: CONTAINER_NAME, image: null });
  });
});

describe("container healthcheck (finding L9)", () => {
  it("is healthy for a fresh liveness stamp and unhealthy for a stale or missing one", async () => {
    await writeJsonAtomic(livenessFile(root), { at: new Date(NOW - 20_000).toISOString() });

    expect(await isLivenessFresh(livenessFile(root), NOW)).toBe(true);
    expect(await isLivenessFresh(livenessFile(root), NOW + 45_000)).toBe(false);
    expect(await isLivenessFresh(join(root, "missing.json"), NOW)).toBe(false);
  });

  it("is fed by the heartbeat loop on the backup volume, not by the app-writable heartbeat.json", async () => {
    const docker = new FakeDocker();
    await rm(join(root, "updater"), { recursive: true });
    await writeFile(join(root, "updater"), "the app replaced the directory with a file");

    await expect(heartbeatFor(docker)()).rejects.toThrow();

    expect(await isLivenessFresh(livenessFile(root), NOW)).toBe(true);
  });
});

describe("state files", () => {
  it("treats a half-written file as absent", async () => {
    const file = join(root, "updater", "request.json");
    await writeFile(file, '{"id": "abc", "targ');

    expect(await readJsonFile(file, MAX_SMALL_JSON_BYTES)).toBeNull();
  });

  it("writes atomically without leaving temporary files behind", async () => {
    await writeJsonAtomic(heartbeatFile, { a: 1 });
    await writeJsonAtomic(heartbeatFile, { a: 2 });

    expect(JSON.parse(await readFile(heartbeatFile, "utf8"))).toEqual({ a: 2 });
    expect(await readdir(join(root, "updater"))).toEqual(["heartbeat.json"]);
  });
});

describe("configuration", () => {
  it("requires SERVIO_IMAGE", () => {
    expect(() => loadConfig({})).toThrow("SERVIO_IMAGE is required");
  });

  it.each(["ghcr.io/x/servio:latest", "ghcr.io/x/servio@sha256:abc", "UPPER/case", "has space/img", "-leading"])(
    "rejects SERVIO_IMAGE %s",
    (image) => {
      expect(() => loadConfig({ SERVIO_IMAGE: image })).toThrow("SERVIO_IMAGE");
    },
  );

  it("accepts a registry with a port", () => {
    expect(loadConfig({ SERVIO_IMAGE: "registry.local:5000/team/servio" }).image).toBe("registry.local:5000/team/servio");
  });

  it("rejects an invalid container name and invalid numbers", () => {
    expect(() => config({ SERVIO_CONTAINER: "bad name; rm" })).toThrow("SERVIO_CONTAINER");
    expect(() => config({ BACKUP_KEEP: "0" })).toThrow("BACKUP_KEEP");
    expect(() => config({ HEALTH_TIMEOUT_SECONDS: "abc" })).toThrow("HEALTH_TIMEOUT_SECONDS");
  });

  it("applies the documented defaults", () => {
    expect(loadConfig({ SERVIO_IMAGE: IMAGE_REPO })).toMatchObject({
      stateDir: "/data/state",
      dbFile: "/data/servio.db",
      backupDir: "/backups",
      backupKeep: 5,
      healthTimeoutMs: 300_000,
      allowUpdateWithoutBackup: false,
      dockerEndpoint: { socketPath: "/var/run/docker.sock" },
      apiVersion: "v1.44",
      allowDowngrade: false,
      allowPrerelease: false,
      retryCooldownMs: 3_600_000,
      pullTimeoutMs: 1_800_000,
      requestMaxAgeMs: 3_600_000,
    });
  });

  it("reads ALLOW_BIND_MOUNTS_FROM as absolute directories and refuses relative ones", () => {
    expect(loadConfig({ SERVIO_IMAGE: IMAGE_REPO }).allowedBindSources).toEqual([]);
    expect(config({ ALLOW_BIND_MOUNTS_FROM: "/srv/servio/, /var/log" }).allowedBindSources).toEqual(["/srv/servio", "/var/log"]);
    expect(() => config({ ALLOW_BIND_MOUNTS_FROM: "data" })).toThrow("ALLOW_BIND_MOUNTS_FROM");
  });

  it("reports the version from updater/package.json", () => {
    expect(config().updaterVersion).toMatch(/^\d+\.\d+\.\d+/);
  });
});
